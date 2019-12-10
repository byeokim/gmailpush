# Gmailpush

Gmailpush is Node.js library for handling Gmail API push notifications using [Google APIs Node.js Client](https://github.com/googleapis/google-api-nodejs-client).

*Note: Gmailpush is not affiliated with Gmail.*

## Features

- Fields parsed from original message's `payload`, e.g. from, to, subject, body
- Filter by `historyTypes`, e.g. `messageAdded`, `labelRemoved`
- Filter by `labelIds`, e.g. `INBOX`, `UNREAD`
- Automatic renewal of [mailbox watch request](https://developers.google.com/gmail/api/guides/push#renewing_mailbox_watch)
- Uses JSON file to store each Gmail user's previous `historyId` and watch request `expiration`

## Prerequisites

Gmail API

- OAuth2 client ID and client secret ([how to get](https://developers.google.com/gmail/api/auth/web-server#create_a_client_id_and_client_secret))
- Access token for user's Gmail data ([how to get](https://developers.google.com/gmail/api/auth/web-server#handling_authorization_requests), [quickstart](https://developers.google.com/gmail/api/quickstart/nodejs))

Google Cloud Pub/Sub

- Ownership-validated domain ([how to validate](https://cloud.google.com/pubsub/docs/push#domain_ownership_validation))
- Pub/Sub topic and subscription ([how to create](https://developers.google.com/gmail/api/guides/push#initial_cloud_pubsub_setup)) with push endpoint URL being set ([how to set](https://cloud.google.com/pubsub/docs/admin#change_pull_push))

## Installation

### npm

```bash
$ npm install gmailpush
```

### yarn

```bash
$ yarn add gmailpush
```

## Usage

```js
const express = require('express');
const Gmailpush = require('gmailpush');

const app = express();

const gmailpush = new Gmailpush({
  clientId: '12345abcdefg.apps.googleusercontent.com',
  clientSecret: 'hijklMNopqrstU12vxY345ZA',
  pubsubTopic: 'projects/PROJECT_NAME/topics/TOPIC_NAME'
});

const users = [
  {
    email: 'user1@gmail.com',
    token: {
      access_token: 'ABcdefGhiJKlmno-PQ',
      refresh_token: 'RstuVWxyzAbcDEfgh',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      token_type: 'Bearer',
      expiry_date: 1543210123451
    }
  }
];

app.post(
  'GMAIL_PUBSUB_PUSH_ENDPOINT',
  // Parse JSON request payload
  express.json(),
  (req, res) => {
    // Acknowledge Gmail push notification webhook
    res.sendStatus(200);
    
    // Get Email address contained in the push notification
    const email = gmailpush.getEmailAddress(req.body);

    // Get access token for the Email address
    const token = users.find((user) => user.email === email).token;

    gmailpush
      .getMessages({
        notification: req.body,
        token
      })
      .then((messages) => {
        console.log(messages);
      })
      .catch((err) => {
        console.log(err);
      });
  }
);

app.listen(3000, () => {
  console.log('Server listening on port 3000...');
});
```

## Initialization

### new Gmailpush(options)

#### Usage

```js
const Gmailpush = require('gmailpush');

const gmailpush = new Gmailpush({
  clientId: 'GMAIL_OAUTH2_CLIENT_ID',
  clientSecret: 'GMAIL_OAUTH2_CLIENT_SECRET',
  pubsubTopic: 'GMAIL_PUBSUB_TOPIC',
  prevHistoryIdFilePath: 'gmailpush_history.json'
});
```

#### options `object`

##### clientId (required) `string`

Gmail API OAuth2 client ID. Follow this [instruction](https://developers.google.com/gmail/api/auth/web-server#create_a_client_id_and_client_secret) to create.

##### clientSecret (required) `string`

Gmail API OAuth2 client secret. Follow this [instruction](https://developers.google.com/gmail/api/auth/web-server#create_a_client_id_and_client_secret) to create.

##### pubsubTopic (required) `string`

Google Cloud Pub/Sub API's topic. Value should be provided as `'projects/PROJECT_NAME/topics/TOPIC_NAME'`. Used to call [`watch()`](https://developers.google.com/gmail/api/guides/push#renewing_mailbox_watch). Follow this [instruction](https://developers.google.com/gmail/api/guides/push#initial_cloud_pubsub_setup) to create.

##### prevHistoryIdFilePath `string`

File path for storing `emailAddress`, `prevHistoryId` and `watchExpiration`.

- `emailAddress`: Email address of a user for whom Gmail push notification messages are sent.

- `prevHistoryId`: Gmail API's push notification messages are not *real* messages but contain `historyId` which is the latest `historyId` as of the time they are sent. To retrieve real messages, one needs to request [history](https://developers.google.com/gmail/api/v1/reference/users/history/list) of changes to the user's mailbox since a certain `historyId`. But `historyId` in the push notification message cannot be used for the certain `historyId` because it is the latest one after which no changes have been made. So Gmailpush stores `historyId` from the push notification message for later use when next push notification message is received.

- `watchExpiration`: Google Cloud Pub/Sub API requires calling `watch()` [at least every 7 days](https://developers.google.com/gmail/api/guides/push#renewing_mailbox_watch). Otherwise push notification will be stopped. So Gmailpush stores watch expiration and calls `watch()` one day before expiration.

Default is `'gmailpush_history.json'`. Example `gmailpush_history.json` is as follows:

```js
[
  {
    "emailAddress": "user1@gmail.com",
    "prevHistoryId": 9876543210,
    "watchExpiration": 1576543210
  },
  {
    "emailAddress": "user2@gmail.com",
    "prevHistoryId": 1234567890,
    "watchExpiration": 1576543211
  }
]
```

## API

### getMessages(options)

Gets Gmail messages which have caused change to [history](https://developers.google.com/gmail/api/v1/reference/users/history/list) since `prevHistoryId` which is the `historyId` as of the previous push notification and is stored in `prevHistoryIdFilePath`.

Messages can be filtered by options. For example, `messages` in the following usage will be an array of messages that have `INBOX` label in their `labelIds` and have added `IMPORTANT` label to their `labelIds`.

Return value of this method includes attachment data as `Buffer`. Alternatively you can use `getMessagesWithoutAttachment()` which doesn't include attachment data.

Gmail API sends push notifications for many reasons of which some are not related to four history types, i.e. `messageAdded`, `messageDeleted`, `labelAdded` and `labelRemoved`. So this method will return an empty array if an element of history array doesn't have `messagesAdded`, `messagesDeleted`, `labelsAdded` or `labelsRemoved` as its property.

#### Usage

```js
const messages = await gmailpush.getMessages({
  notification: req.body,
  token,
  historyTypes: ['labelAdded'],
  addedLabelIds: ['IMPORTANT'],
  withLabelIds: ['INBOX']
});
```

#### options `object`

##### notification (required) `object`

An object which is JSON-parsed from Gmail API's [push notification message](https://developers.google.com/gmail/api/guides/push#receiving_notifications). Push notification messages should be JSON-parsed using `JSON.parse()` or middleware like [`express.json()`](http://expressjs.com/en/guide/using-middleware.html#middleware.built-in) or [`body-parser`](https://www.npmjs.com/package/body-parser) before passed to `notification`.

Below is an example `notification` object:

```js
{
  message: {
    // This is the actual notification data, as base64url-encoded JSON.
    data: 'eyJlbWFpbEFkZHJlc3MiOiJ1c2VyMUBnbWFpbC5jb20iLCJoaXN0b3J5SWQiOiI5ODc2NTQzMjEwIn0=',
    // This is a Cloud Pub/Sub message id, unrelated to Gmail messages.
    message_id: '1234567890',
  },
  subscription: 'projects/PROJECT_NAME/subscriptions/SUBSCRIPTION_NAME'
}
```


And `JSON.parse(Buffer.from(notification.message.data, 'base64').toString())` would result in the following object:

```js
{
  emailAddress: 'user1@gmail.com',
  historyId: '9876543210'
}
```

##### token (required) `object`

Gmail API OAuth2 [access token](https://developers.google.com/gmail/api/auth/web-server#handling_authorization_requests) for user's Gmail data which has the following form:

```js
{
  access_token: 'USER1_ACCESS_TOKEN',
  refresh_token: 'USER1_REFRESH_TOKEN',
  scope: 'USER1_SCOPE',
  token_type: 'USER1_TOKEN_TYPE',
  expiry_date: 'USER1_EXPIRY_DATE'
}
```

##### historyTypes `array of strings`

Specifies which types of change to [history](https://developers.google.com/gmail/api/v1/reference/users/history/list) this method should consider. There are four types of change.

- `messageAdded`: Messages have been added to mailbox, e.g. sending or receiving an Email.
- `messageDeleted`: Messages have been deleted from mailbox, e.g. deleting an Email in Trash.
- `labelAdded`: Messages have added label ids, e.g. `TRASH` would be added when delete an Email.
- `labelRemoved`: Messages have removed label ids, e.g. `UNREAD` would be removed when read an unread Email.

Elements in `historyTypes` will be OR-ed. Default is `['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']`.

##### addedLabelIds `array of strings`

Used with `labelAdded` history type to specify which added label ids to monitor. Elements will be OR-ed. If not provided, Gmailpush won't filter by `addedLabelIds`. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`.

##### removedLabelIds `array of strings`

Used with `labelRemoved` history type to specify which removed label ids to monitor. Elements will be OR-ed. If not provided, Gmailpush won't filter by `removedLabelIds`. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`.

##### withLabelIds `array of strings`

Specifies which label ids should be included in `labelIds` of messages this method returns. Elements will be OR-ed. If not provided, Gmailpush won't filter by `withLabelIds`. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`. `withLabelIds` and `withoutLabelIds` cannot contain the same label id.

##### withoutLabelIds `array of strings`

Specifies which label ids should *not* be included in `labelIds` of messages this method returns. Elements will be OR-ed. If not provided, Gmailpush won't filter by `withoutLabelIds`. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`. `withLabelIds` and `withoutLabelIds` cannot contain the same label id.

#### Return `array of objects || []`

An array of message objects with attachment data included. If there is no message objects that satisfy criteria set by options, an empty array will be returned.

##### Example return

```js
[
  {
    id: 'fedcba9876543210',
    threadId: 'fedcba9876543210',
    labelIds: [ 'CATEGORY_PERSONAL', 'INBOX', 'UNREAD', 'IMPORTANT' ],
    snippet: 'this is body',
    historyId: '987654321',
    internalDate: '1543210123451',
    payload: {
      partId: '',
      mimeType: 'multipart/alternative',
      filename: '',
      headers: [Array],
      body: [Object],
      parts: [Array]
    },
    sizeEstimate: 4321,
    historyType: 'labelAdded',
    from: { name: 'user', address: 'user@example.com' },
    to: [ { name: 'user1', address: 'user1@gmail.com' } ],
    subject: 'this is subject',
    date: 'Tue, 1 Jan 2019 00:00:00 +0000',
    attachments: [
      {
        mimeType: 'image/jpeg',
        filename: 'example.jpg',
        attachmentId: 'abcdef0123456789',
        size: 2,
        data: <Buffer ff ff ff ff>
      }
    ],
    bodyText: 'this is body\r\n',
    bodyHtml: '<div dir="ltr">this is body</div>\r\n'
  }
]
```

### getMessagesWithoutAttachment(options)

Same as `getMessages()` except that elements of `attachments` don't have `data`.

#### Usage

```js
const messages = await gmailpush.getMessagesWithoutAttachment({
  notification: req.body,
  token,
  historyTypes: ['messageAdded']
});
```

#### Options `object`

Same as those of `getMessages()`.

#### Return `array of objects || []`

Same as that of `getMessages()` except that elements of `attachments` don't have `data`.

##### Example `attachments` in return

```js
[
  {
    mimeType: 'image/jpeg',
    filename: 'example.jpg',
    attachmentId: 'abcdef0123456789',
    size: 2
  }
]
```

### getAttachment(message, attachment)

Gets attachment data as Node.js [`Buffer`](https://nodejs.org/api/buffer.html). `getMessages()` is actually wrapper of `getMessagesWithoutAttachment()` and `getAttachment()`.

#### message `object`

Message object returned by `getMessagesWithoutAttachment()`, of which `id` will be used to call [`gmail.users.messages.attachments.get()`](https://developers.google.com/gmail/api/v1/reference/users/messages/attachments/get).

#### attachment `object`

Attachment object in the above message object, of which `attachmentId` will be used to call [`gmail.users.messages.attachments.get()`](https://developers.google.com/gmail/api/v1/reference/users/messages/attachments/get).

#### Return `Buffer`

[`Buffer`](https://nodejs.org/api/buffer.html) instance of attachment data.

### getNewMessage(options)

Gets only a new Email received at inbox. This method is implementation of `getMessages()` with the following options:

```js
{
  historyTypes: ['messageAdded'],
  withLabelIds: ['INBOX'],
  withoutLabelIds: ['SENT']
}
```

#### Usage

```js
const message = await gmailpush.getNewMessage({
  notification: req.body,
  token
});
```

#### options `object`

##### notification (required) `object`

Same as that of `getMessages()`.

##### token (required) `object`

Same as that of `getMessages()`.

#### Return `object || null`

Message object which is the first element of array returned by `getMessages()`. Gmailpush assumes that the array is either one-element or empty array. If there is no message object that satisfies criteria set by options, `null` will be returned.

### getEmailAddress(notification)

Gets Email address from a push notification.

#### Usage

```js
const email = await gmailpush.getEmailAddress(req.body);
```

#### notification (required) `object`

Same as that of `getMessages()`.

#### Return `string`

Email address.

### getLabels(notification, token)

Gets a list of labels which can be used to find label ids for user-generated labels because user-generated labels' `id` is not same as their `name`.

#### Usage

```js
const labels = await gmailpush.getLabels(req.body, token);
```

#### notification (required) `object`

Same as that of `getMessages()`.

#### token (required) `object`

Same as that of `getMessages()`.

#### Return `array of objects`

Array of [`label`](https://developers.google.com/gmail/api/v1/reference/users/labels) objects.

##### Example return

```js
[
  {
    id: 'INBOX',
    name: 'INBOX',
    messageListVisibility: 'hide',
    labelListVisibility: 'labelShow',
    type: 'system'
  },
  {
    id: 'Label_1',
    name: 'Invoice',
    messageListVisibility: 'show',
    labelListVisibility: 'labelShow',
    type: 'user',
    color: { textColor: '#222222', backgroundColor: '#eeeeee' }
  }
]
```

## License

[MIT](LICENSE)