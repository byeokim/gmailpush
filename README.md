# Gmailpush

Gmailpush is Node.js library for handling Gmail API push notifications using [Google APIs Node.js Client](https://github.com/googleapis/google-api-nodejs-client).

*Note: Gmailpush is not affiliated with Gmail.*

## Features

- Fields such as from, to, subject and body parsed from original message's `payload`
- Filter by types of history, e.g. `messageAdded`, `labelRemoved`
- Filter by label ids, e.g. `INBOX`, `UNREAD`
- Automatic renewal of [mailbox watch request](https://developers.google.com/gmail/api/guides/push#renewing_mailbox_watch)
- Uses JSON file to store each user's Gmail API history id and watch request expiration

## Prerequisites

Gmail API

- OAuth2 client ID and client secret ([how to get](https://developers.google.com/gmail/api/auth/web-server#create_a_client_id_and_client_secret))
- Access token for user's Gmail data ([how to get](https://developers.google.com/gmail/api/auth/web-server#handling_authorization_requests), [quickstart](https://developers.google.com/gmail/api/quickstart/nodejs))

Google Cloud Pub/Sub

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

## Example

### Request

```js
const express = require('express');
const Gmailpush = require('gmailpush');

const app = express();

// Initialize with OAuth2 config and Pub/Sub topic
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
  // Use URL set as Pub/Sub Subscription endpoint
  '/pubsub-push-endpoint',
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

### Response

```js
[
  {
    id: 'fedcba9876543210',
    threadId: 'fedcba9876543210',
    labelIds: [ 'CATEGORY_PERSONAL', 'INBOX', 'UNREAD', 'IMPORTANT' ],
    snippet: 'this is body',
    historyId: '987654321',
    historyType: 'labelAdded',
    internalDate: '1546300800000',
    date: 'Tue, 1 Jan 2019 00:00:00 +0000',
    from: { name: 'user', address: 'user@example.com' },
    to: [ { name: 'user1', address: 'user1@gmail.com' } ],
    subject: 'this is subject',
    bodyText: 'this is body\r\n',
    bodyHtml: '<div dir="ltr">this is body</div>\r\n',
    attachments: [
      {
        mimeType: 'image/jpeg',
        filename: 'example.jpg',
        attachmentId: 'abcdef0123456789',
        size: 2,
        data: <Buffer ff ff ff ff>
      }
    ],
    payload: {
      partId: '',
      mimeType: 'multipart/alternative',
      filename: '',
      headers: [Array],
      body: [Object],
      parts: [Array]
    },
    sizeEstimate: 4321
  }
]
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

- `prevHistoryId`: Gmail API's push notification messages are not *real* messages but contain `historyId` which is the latest history id as of the time they are sent. To retrieve real messages, one needs to request for [history](https://developers.google.com/gmail/api/v1/reference/users/history/list) of changes to the user's mailbox since a certain history id. But `historyId` in the push notification message cannot be used for that certain history id because it is the latest one after which no changes have been made. So Gmailpush stores `historyId` from the push notification message for later use when next push notification message is received. Similarly the first push notification since installing Gmailpush could not be turned into messages but an empty array because the history id used for the first `getMessages()` is the latest one.

- `watchExpiration`: Google Cloud Pub/Sub API requires calling `watch()` [at least every 7 days](https://developers.google.com/gmail/api/guides/push#renewing_mailbox_watch). Otherwise push notification will be stopped. Whenever Gmailpush is initialized, it calls `watch()` to extend expiration for 7 days. And Gmailpush stores watch expiration so that schedulers like [node-schedule](https://github.com/node-schedule/node-schedule) can use it to call `watch()` before expiration.

Methods like `getMessages()`, `getMessagesWithoutAttachment()` and `getNewMessage` will automatically create a file using `prevHistoryIdFilePath` if the file doesn't exist.

Default is `'gmailpush_history.json'` and its content would be like:

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

The first call of this method for a user will result in an empty array as returned value and store `prevHistoryId` in `gmailpush_history.json`. (also create the file if not exists)

When a Gmail user is composing a new message, every change the user has made to the draft (even typing a single character) causes two push notifications, i.e. `messageDeleted` type for deletion of the last draft and `messageAdded` type for addition of current draft.

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

##### historyTypes `string[]`

Specifies which types of change to [history](https://developers.google.com/gmail/api/v1/reference/users/history/list) this method should consider. There are four types of change.

- `messageAdded`: Messages have been added to mailbox, e.g. sending or receiving an Email.
- `messageDeleted`: Messages have been deleted from mailbox, e.g. deleting an Email in Trash.
- `labelAdded`: Messages have added label ids, e.g. `TRASH` would be added when delete an Email.
- `labelRemoved`: Messages have removed label ids, e.g. `UNREAD` would be removed when read an unread Email.

Elements in `historyTypes` will be OR-ed. Default is `['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']`.

##### addedLabelIds `string[]`

Used with `labelAdded` history type to specify which added label ids to monitor. Elements will be OR-ed. If not provided, Gmailpush won't filter by `addedLabelIds`. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`.

##### removedLabelIds `string[]`

Used with `labelRemoved` history type to specify which removed label ids to monitor. Elements will be OR-ed. If not provided, Gmailpush won't filter by `removedLabelIds`. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`.

##### withLabelIds `string[]`

Specifies which label ids should be included in `labelIds` of messages this method returns. Elements will be OR-ed. If not provided, Gmailpush won't filter by `withLabelIds`. `withLabelIds` would filter out any messages with `messageDeleted` type of history because they don't have `labelIds`. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`. `withLabelIds` and `withoutLabelIds` cannot contain the same label id.


##### withoutLabelIds `string[]`

Specifies which label ids should *not* be included in `labelIds` of messages this method returns. Elements will be OR-ed. If not provided, Gmailpush won't filter by `withoutLabelIds`. `withoutLabelIds` would not filter out messages with `messageDeleted` type of history because they don't have `labelIds` to be filtered. User-generated labels have label ids which don't match their label names. To get label id for user-generated label, use `getLabels()`. `withLabelIds` and `withoutLabelIds` cannot contain the same label id.

#### Return `object[]`

An array of message objects. If there is no message objects that satisfy criteria set by options, an empty array will be returned.

Gmail API sends push notifications for many reasons of which some are not related to the four history types, i.e. `messageAdded`, `messageDeleted`, `labelAdded` and `labelRemoved`. In those cases this method will return an empty array.

If `prevHistoryId` for a user doesn't exist in `gmailpush_history.json`, calling this method for the user will result in an empty array.

If the messages have attachments, data of the attachments is automatically fetched and appended as [Buffer](https://nodejs.org/api/buffer.html) instance. Alternatively you can use `getMessagesWithoutAttachment()` which returns messages without attachment data.

For `messageDeleted` type of history, because messages would have been deleted before requested, return value for those messages would have no material properties and look like this:

```js
{
  id: 'fedcba9876543210',
  historyType: 'messageDeleted',
  notFound: true, // Indicates that Gmail API has returned "Not Found" error
  attachments: [] // Exists only for internal purpose
}
```

In message object, `from`, `to`, `cc`, `bcc`, `subject`, `date`, `bodyText` and `bodyHtml` are present only when original message has them.

If parsing originator/destination headers like From, To, Cc and Bcc has failed, raw values will be assigned to `from`, `to`, `cc` and `bcc`, respectively. For example, value of To header in the `message.payload.headers` seems to be truncated if it has more than a certain number (about 9,868) of characters. In that case, the last one in the list of recipient Email addresses might look like the following and not be parsed:

```js
// message.payload.headers:
[
  {
    name: 'To',
    value: 'user1@example.com <user1@example.com>, user2@'
  }
]

// message.to:
[
  {
    name: 'user1@example.com',
    address: 'user1@example.com'
  },
  {
    name: 'user2@',
    address: 'user2@'
  }
]
```

From header [can have multiple Email addresses](https://serverfault.com/a/554615) theoretically. But Gmailpush assumes that From header has a single Email address.

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

#### Return `object[]`

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

#### Return `object | null`

Message object which is the first element of array returned by `getMessages()`. Gmailpush assumes that the array is either one-element or empty array. If there is no message object that satisfies criteria set by options, `null` will be returned.

### getEmailAddress(notification)

Gets Email address from a push notification.

#### Usage

```js
const email = gmailpush.getEmailAddress(req.body);
```

#### notification (required) `object`

Same as that of `getMessages()`.

#### Return `string`

Email address.

##### Example return

```js
'user1@gmail.com'
```

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

#### Return `object[]`

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
