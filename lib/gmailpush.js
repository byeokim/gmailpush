'use strict';

const {google} = require('googleapis');
const fs = require('fs').promises;

const GMAIL_API_VERSION = 'v1';
const DEFAULT_HISTORY_ID_FILE_PATH = 'gmailpush_history.json';
const VALID_HISTORY_TYPES = [
  'messageAdded',
  'messageDeleted',
  'labelAdded',
  'labelRemoved',
];

function Gmailpush(options) {
  if (!(this instanceof Gmailpush)) {
    return new Gmailpush(options);
  }

  const props = this._getPropsFromOptions(options, {
    required: ['clientId', 'clientSecret', 'pubsubTopic'],
    optional: ['prevHistoryIdFilePath'],
  });

  this._api = {
    auth: new google.auth.OAuth2(props.clientId, props.clientSecret),
    prevHistoryIdFilePath:
      props.prevHistoryIdFilePath || DEFAULT_HISTORY_ID_FILE_PATH,
    prevHistories: [],
    pubsubTopic: props.pubsubTopic,
  };
}

Gmailpush.prototype = {
  /**
   * Parse payload of Gmail push notification message
   *
   * @param {object} notification Gmail push notification message
   * @returns {object} Parsed payload with two properties:
   *     emailAddress and historyId
   */
  _parseNotificationPayload(notification) {
    return JSON.parse(
      Buffer.from(notification.message.data, 'base64').toString()
    );
  },

  /**
   * Get Email address from Gmail push notification message
   *
   * @param {object} notification Gmail push notification message
   * @returns {string} Email address, e.g. user1@gmail.com
   */
  getEmailAddress(notification) {
    if (notification === undefined) {
      throw new Error('getEmailAddress() requires an argument: notification');
    }

    return this._parseNotificationPayload(notification).emailAddress;
  },

  /**
   * Get historyId from Gmail push notification message
   *
   * @param {object} notification Gmail push notification message
   * @returns {number} historyId, e.g. 9876543210
   */
  _getHistoryId(notification) {
    return Number(this._parseNotificationPayload(notification).historyId);
  },

  /**
   * Initialize Gmailpush before requesting to Gmail API
   *
   * 1. Set OAuth2 instance with access token
   * 2. Create gmail instance
   * 3. Load prevHistoryId
   * 4. Call watch() if necessary
   *
   * @param {object} notification Gmail push notification message
   * @param {object} token Gmail API OAuth2 access token
   * @returns {boolean} Whether to proceed Gmailpush methods or not depending
   *     on if historyId from the push notification is newer than prevHistoryId.
   */
  async _initialize(notification, token) {
    this._api.auth.setCredentials(token);
    this._api.gmail = google.gmail({
      version: GMAIL_API_VERSION,
      auth: this._api.auth,
    });
    this._api.emailAddress = this.getEmailAddress(notification);

    try {
      this._api.prevHistories = JSON.parse(
        await fs.readFile(this._api.prevHistoryIdFilePath)
      );
    } catch (err) {
      if (err.message.startsWith('ENOENT: no such file or directory')) {
        this._api.prevHistories.push({
          emailAddress: this._api.emailAddress,
          prevHistoryId: this._getHistoryId(notification),
          watchExpiration: null,
        });
      } else {
        throw err;
      }
    }

    const prevHistory = this._api.prevHistories.find(
      (prevHistory) => prevHistory.emailAddress === this._api.emailAddress
    );

    // Call watch() to extend watch expiration for 7 days
    prevHistory.watchExpiration = await this._refreshWatch();

    // If newly received historyId is less than or equal to previous historyId,
    // it is unnecessary to get messages, so shouldProceed is set to false
    if (this._getHistoryId(notification) <= prevHistory.prevHistoryId) {
      fs.writeFile(
        this._api.prevHistoryIdFilePath,
        JSON.stringify(this._api.prevHistories)
      );

      return false;
    } else {
      this._api.startHistoryId = prevHistory.prevHistoryId;
      prevHistory.prevHistoryId = this._getHistoryId(notification);

      fs.writeFile(
        this._api.prevHistoryIdFilePath,
        JSON.stringify(this._api.prevHistories)
      );

      return true;
    }
  },

  /**
   * Get history from startHistoryId.
   *
   * If nextPageToken is present in the gmail response,
   * this method will call _getHistory(nextPageToken) recursively to get
   * remaining history.
   *
   * @param {string} pageToken Token for requesting next page of
   *     history if there are more than one page of history
   * @returns {Object[]} History from startHistoryId
   */
  async _getHistory(pageToken) {
    const options = {
      userId: this._api.emailAddress,
      startHistoryId: this._api.startHistoryId,
    };

    if (pageToken) {
      options.pageToken = pageToken;
    }

    const {nextPageToken, history} = (
      await this._api.gmail.users.history.list(options)
    ).data;

    if (nextPageToken) {
      return [].concat(await this._getHistory(nextPageToken));
    }

    return history || [];
  },

  /**
   * Filter history by this._api.historyTypes,
   * and if this._api.addedLabelIds or this._api.removedLabelIds is present,
   * filter further by those label ids.
   *
   * @param {object} history Gmail API history object
   * @returns {object} Filtered history
   */
  _filterHistory(history) {
    let filteredWithHistoryTypes = [];
    for (const historyType of this._api.historyTypes) {
      filteredWithHistoryTypes = filteredWithHistoryTypes.concat(
        history.filter((historyEntry) => {
          if (
            historyEntry.hasOwnProperty(
              this._makeHistoryTypePlural(historyType)
            )
          ) {
            return true;
          } else {
            return false;
          }
        })
      );
    }

    let filteredWithAddedRemovedLabelIds = [];
    filteredWithAddedRemovedLabelIds = filteredWithAddedRemovedLabelIds.concat(
      filteredWithHistoryTypes.filter((historyEntry) => {
        if (
          this._api.addedLabelIds &&
          historyEntry.hasOwnProperty('labelsAdded') &&
          historyEntry.labelsAdded.filter((labelAdded) => {
            for (const addedLabelId of this._api.addedLabelIds) {
              if (labelAdded.labelIds.includes(addedLabelId)) {
                return true;
              }
            }
            return false;
          }).length === 0
        ) {
          return false;
        }

        if (
          this._api.removedLabelIds &&
          historyEntry.hasOwnProperty('labelsRemoved') &&
          historyEntry.labelsRemoved.filter((labelRemoved) => {
            for (const removedLabelId of this._api.removedLabelIds) {
              if (labelRemoved.labelIds.includes(removedLabelId)) {
                return true;
              }
            }
            return false;
          }).length === 0
        ) {
          return false;
        }
        return true;
      })
    );

    return filteredWithAddedRemovedLabelIds;
  },

  /**
   * Get a message which has a specific id. If gmail response is
   * 'Not Found' error, return dummy message object with
   * id, attachments and notFound.
   *
   * @param {string} messageId Id of message to be requested for
   * @returns {object} Message which has messageId as its id
   */
  _getMessageFromId(messageId) {
    return this._api.gmail.users.messages
      .get({
        id: messageId,
        userId: this._api.emailAddress,
      })
      .then((result) => result.data)
      .catch((err) => {
        if (err.message === 'Not Found') {
          return {
            // For identifying which message was not found
            id: messageId,
            // For this message object to be passed through getAttachment()
            attachments: [],
            // Normal messages don't have notFound property
            notFound: true,
          };
        }

        throw err;
      });
  },

  /**
   * Filter message by withLabelIds and withoutLabelIds. If there is
   * no withLabelIds nor withoutLabelIds, don't filter.
   *
   * @param {object} message Gmail API message object
   * @returns {boolean} Whether the message has passes filter or not
   */
  _filterMessage(message) {
    if (
      this._api.withLabelIds &&
      this._api.withoutLabelIds &&
      this._api.withLabelIds.filter((labelId) =>
        this._api.withoutLabelIds.includes(labelId)
      ).length > 0
    ) {
      throw new Error(
        'withLabelIds and withoutLabelIds should not have the same labelId'
      );
    }

    // Because "Not Found" message doesn't have labelIds property,
    // filter out the message when withLabelIds is set.
    if (!message.labelIds && this._api.withLabelIds) {
      return false;
    }

    if (
      message.labelIds &&
      this._api.withLabelIds &&
      this._api.withLabelIds.filter((withLabelId) =>
        message.labelIds.includes(withLabelId)
      ).length === 0
    ) {
      return false;
    }

    if (
      message.labelIds &&
      this._api.withoutLabelIds &&
      this._api.withoutLabelIds.filter((withoutLabelId) =>
        message.labelIds.includes(withoutLabelId)
      ).length > 0
    ) {
      return false;
    }

    return true;
  },

  /**
   * Extract data from payload of message and attach them to message
   * as properties. If there is nested payload, call _parsePayload()
   * recursively.
   *
   * @param {object} payload Payload to be parsed
   * @param {object} parsedMessage Message to which extracted data
   *     will be attached
   */
  _parsePayload(payload, parsedMessage) {
    if (payload.mimeType.startsWith('multipart/')) {
      for (const part of payload.parts) {
        this._parsePayload(part, parsedMessage);
      }
    } else if (payload.mimeType === 'text/html') {
      parsedMessage.bodyHtml = Buffer.from(
        payload.body.data,
        'base64'
      ).toString();
    } else if (payload.mimeType === 'text/plain') {
      parsedMessage.bodyText = Buffer.from(
        payload.body.data,
        'base64'
      ).toString();
    } else if (
      payload.mimeType.startsWith('image/') ||
      payload.mimeType.startsWith('audio/') ||
      payload.mimeType.startsWith('video/') ||
      payload.mimeType.startsWith('application/') ||
      payload.mimeType.startsWith('font/') ||
      payload.mimeType.startsWith('model/')
    ) {
      parsedMessage.attachments.push({
        mimeType: payload.mimeType,
        filename: payload.filename,
        attachmentId: payload.body.attachmentId,
        size: payload.body.size,
      });
    }
  },

  /**
   * Parse message and call _parsePayload(). Parse means that
   * searching for from, to, subject headers and attaching the header
   * values to message object.
   *
   * @param {object} message Gmail API message object to be parsed
   * @param {object} historyEntry An element of history array which has
   *     type of change to the historyEntry message object has caused.
   * @returns {object} Parsed message
   */
  _parseMessage(message, historyEntry) {
    const parsedMessage = Object.assign({}, message);

    // Assume that historyEntry has only one type of VALID_HISTORY_TYPES
    parsedMessage.historyType =
      VALID_HISTORY_TYPES.filter((historyType) =>
        historyEntry.hasOwnProperty(this._makeHistoryTypePlural(historyType))
      )[0] || '';

    // Because deleted messages and notFound messages don't have payload property
    // thus don't need to be parsed, and attachments property has already been
    // included as an empty array, return with just historyType added.
    if (!message.hasOwnProperty('payload')) {
      return parsedMessage;
    }

    const from = message.payload.headers.find(
      (header) => header.name === 'From'
    );

    if (from) {
      parsedMessage.from = this._parseEmailAddressHeader(from.value);
    }

    const to = message.payload.headers.find((header) => header.name === 'To');

    if (to) {
      parsedMessage.to = [];
      to.value
        .split(', ')
        .forEach((e) =>
          parsedMessage.to.push(this._parseEmailAddressHeader(e))
        );
    }

    const cc = message.payload.headers.find((header) => header.name === 'Cc');

    if (cc) {
      parsedMessage.cc = [];
      cc.value
        .split(', ')
        .forEach((e) =>
          parsedMessage.cc.push(this._parseEmailAddressHeader(e))
        );
    }

    const bcc = message.payload.headers.find((header) => header.name === 'Bcc');

    if (bcc) {
      parsedMessage.bcc = [];
      bcc.value
        .split(', ')
        .forEach((e) =>
          parsedMessage.bcc.push(this._parseEmailAddressHeader(e))
        );
    }

    const subject = message.payload.headers.find(
      (header) => header.name === 'Subject'
    );

    if (subject) {
      parsedMessage.subject = subject.value;
    }

    const date = message.payload.headers.find(
      (header) => header.name === 'Date'
    );

    if (date) {
      parsedMessage.date = date.value;
    }

    parsedMessage.attachments = [];

    this._parsePayload(message.payload, parsedMessage);

    return parsedMessage;
  },

  /**
   * Get messages without attachment data
   *
   * @param {object} options
   * @param {object} options.notification Gmail push notification message
   * @param {object} options.token Gmail API OAuth2 access token
   * @param {string[]} [options.historyTypes] Types of
   *     history message should have caused change to history.
   * @param {string[]} [options.withLabelIds] Label ids which should be
   *     included in `labelIds` of messages this method returns.
   * @param {string[]} [options.withoutLabelIds] Label ids which should not be
   *     included in `labelIds` of messages this method returns.
   * @returns {object[]} Array of messages without attachment data || []
   */
  async getMessagesWithoutAttachment(options) {
    const props = this._getPropsFromOptions(options, {
      required: ['notification', 'token'],
      optional: [
        'historyTypes',
        'addedLabelIds',
        'removedLabelIds',
        'withLabelIds',
        'withoutLabelIds',
      ],
    });

    this._setApiPropertiesWithProps(props);

    let messages = [];

    const shouldProceed = await this._initialize(
      props.notification,
      props.token
    );

    if (shouldProceed) {
      const history = await this._getHistory().then((history) =>
        this._filterHistory(history)
      );

      if (history && history.length > 0) {
        messages = (
          await Promise.all(
            history.map((historyEntry) =>
              Promise.all(
                historyEntry.messages.map((message) =>
                  this._getMessageFromId(message.id).then((message) =>
                    this._parseMessage(message, historyEntry)
                  )
                )
              )
            )
          )
        ).reduce((messages, message) => messages.concat(message), []);

        // Because history doesn't have labelIds in its messages properties,
        // filtering by withLabelIds and withoutLabelIds has to be done
        // with message objects. It was hard to implement filtering in
        // history.map() routine. So here it is.
        messages = messages.filter((message) => this._filterMessage(message));
      }
    }

    return messages;
  },

  /**
   * Get attachment data
   *
   * @param {object} message Message which has attachments
   * @param {object} attachment An element of message.attachments
   * @returns {object} Buffer instance of attachment data
   */
  async getAttachment(message, attachment) {
    const {data} = (
      await this._api.gmail.users.messages.attachments.get({
        id: attachment.attachmentId,
        messageId: message.id,
        userId: this._api.emailAddress,
      })
    ).data;

    return Buffer.from(data, 'base64');
  },

  /**
   * Get messages with attachment data
   *
   * @param {object} options
   * @param {object} options.notification Gmail push notification message
   * @param {object} options.token Gmail API OAuth2 access token
   * @param {string[]} [options.historyTypes] Types of
   *     history message should have caused change to history.
   * @param {string[]} [options.withLabelIds] Label ids which should be
   *     included in `labelIds` of messages this method returns.
   * @param {string[]} [options.withoutLabelIds] Label ids which should not be
   *     included in `labelIds` of messages this method returns.
   * @returns {object[]} Array of messages with attachment data || []
   */
  async getMessages(options) {
    const messages = await this.getMessagesWithoutAttachment(options);

    await Promise.all(
      messages.map((message) =>
        Promise.all(
          message.attachments.map(async (attachment) => {
            attachment.data = await this.getAttachment(message, attachment);
          })
        )
      )
    );

    return messages;
  },

  /**
   * Get a newly received message with attachment data
   *
   * @param {object} options
   * @param {object} options.notification Gmail push notification message
   * @param {object} options.token Gmail API OAuth2 access token
   * @returns {object} A message with attachment data || null
   */
  async getNewMessage(options) {
    const props = this._getPropsFromOptions(options, {
      required: ['notification', 'token'],
    });

    props.historyTypes = ['messageAdded'];
    props.withLabelIds = ['INBOX'];
    props.withoutLabelIds = ['SENT'];

    // Assume resulting messages to be either one-element or empty array,
    // although the assumption is not verified.
    const message = (await this.getMessagesWithoutAttachment(props))[0] || null;

    if (message) {
      await Promise.all(
        message.attachments.map(async (attachment) => {
          attachment.data = await this.getAttachment(message, attachment);
        })
      );
    }

    return message;
  },

  /**
   * Validate options with rules
   *
   * @param {object} options Options to be validated
   * @param {object} rules Rules specifying required options and optional options
   * @returns {object} Same options as options argument
   *
   * Reference
   * @see {@link https://github.com/stripe/stripe-node/blob/67ec167d58db070f48fe68dd0dc265a7994c13d2/lib/stripe.js#L305}
   */
  _getPropsFromOptions(options, rules) {
    if (!options) {
      throw new Error(`Options must have ${rules.required.join(', ')}`);
    }

    const isObject = options === Object(options) && !Array.isArray(options);

    if (!isObject) {
      throw new Error('Options must be an object');
    }

    const unexpectedOptionValues = Object.keys(options).filter(
      (value) => !rules.required.concat(rules.optional || []).includes(value)
    );

    if (unexpectedOptionValues.length > 0) {
      throw new Error(
        `Options may only contain the following: ${rules.required
          .concat(rules.optional || [])
          .join(', ')}`
      );
    }

    const omittedRequiredOptionValues = rules.required.filter(
      (value) => !Object.keys(options).includes(value)
    );

    if (omittedRequiredOptionValues.length > 0) {
      throw new Error(
        `Options must have the following: ${omittedRequiredOptionValues.join(
          ', '
        )}`
      );
    }

    return options;
  },

  /**
   * Call gmail.users.watch() for renewing Pub/Sub push notification watch expiration
   *
   * returns {number} New watchExpiration
   */
  _refreshWatch() {
    return this._api.gmail.users
      .watch({
        userId: this._api.emailAddress,
        requestBody: {
          topicName: this._api.pubsubTopic,
        },
      })
      .then((result) => Number(result.data.expiration));
  },

  /**
   * Set properties to this._api. This could not be combined with _getPropsFromOptions()
   * because _getPropsFromOptions() has some code used by Gmailpush constructor function.
   *
   * @param {object} props Props that are options validated from _getPropsFromOptions()
   */
  _setApiPropertiesWithProps(props) {
    // Set historyTypes
    if (
      props.historyTypes &&
      props.historyTypes.filter(
        (historyType) => !VALID_HISTORY_TYPES.includes(historyType)
      ).length > 0
    ) {
      throw new Error(
        `historyTypes option may only contain the following: ${VALID_HISTORY_TYPES.join(
          ', '
        )}`
      );
    }

    this._api.historyTypes = props.historyTypes || VALID_HISTORY_TYPES;

    // Set addedLabelIds
    if (props.addedLabelIds) {
      if (!props.historyTypes.includes('labelAdded')) {
        throw new Error(
          'addedLabelIds option should be used with labelAdded historyType'
        );
      }
      this._api.addedLabelIds = props.addedLabelIds;
    }

    // Set removedLabelIds
    if (props.removedLabelIds) {
      if (!props.historyTypes.includes('labelRemoved')) {
        throw new Error(
          'removedLabelIds option should be used with labelRemoved historyType'
        );
      }
      this._api.removedLabelIds = props.removedLabelIds;
    }

    // Set withLabelIds
    if (props.withLabelIds) {
      this._api.withLabelIds = props.withLabelIds;
    }

    // Set withoutLabelIds
    if (props.withoutLabelIds) {
      this._api.withoutLabelIds = props.withoutLabelIds;
    }
  },

  /**
   * Make historyType plural noun, e.g. messageAdded -> messagesAdded,
   * because properties in history object have plural noun.
   *
   * @param {string} historyType Singular noun historyType
   * @returns {string} Plural noun historyType
   */
  _makeHistoryTypePlural(historyType) {
    return historyType.replace(/^message|label/, '$&s');
  },

  /**
   * Get labels
   *
   * @param {object} notification Gmail push notification message
   * @param {object} token Gmail API OAuth2 access token
   * @returns {object[]} Array of label objects
   */
  getLabels(notification, token) {
    if (notification === undefined || token === undefined) {
      throw new Error(
        'getLabels() requires two arguments: notification and token'
      );
    }

    this._api.auth.setCredentials(token);
    this._api.gmail = google.gmail({
      version: GMAIL_API_VERSION,
      auth: this._api.auth,
    });

    return this._api.gmail.users.labels
      .list({
        userId: this._parseNotificationPayload(notification).emailAddress,
      })
      .then((result) => result.data.labels);
  },

  /**
   * Parse Email address header in the original Gmail API message using RegExp to
   * get name part and address part. If parsing failed, return the unparsed header.
   *
   * @param {string} emailAddressHeader For example 'user1 <user1@gmail.com>'
   * @returns {object} Parsed Email object which has name and address properties
   */
  _parseEmailAddressHeader(emailAddressHeader) {
    const parsedHeader = emailAddressHeader.match(
      /(?:(.*)\s)?(?:<?(.+@[^>]+)>?)/
    );

    if (parsedHeader) {
      return {
        name: parsedHeader[1] || parsedHeader[2],
        address: parsedHeader[2],
      };
    } else {
      return {
        name: emailAddressHeader,
        address: emailAddressHeader,
      };
    }
  },
};

module.exports = Gmailpush;
