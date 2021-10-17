import Fastify from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import * as uuid from 'uuid';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

const apiId = 8785191;
const apiHash = "2d992b9e1de1379ee28e9d027fc3b716";

const clients = new Map<string, TelegramClient>();
const phoneCodeResolvers = new Map<string, (value: string | PromiseLike<string>) => void>();
const loginPromises = new Map<string, Promise<void>>();

const server = Fastify({
  logger: true,
});

server.get('/', async (req, res) => {
  return 'It worked!';
});

const LoginBody = Type.Object({
  phoneNumber: Type.String(),
  password: Type.Optional(Type.String()),
});
type LoginBodyType = Static<typeof LoginBody>;

server.post<{ Body: LoginBodyType; }>('/login', {
  schema: {
    body: LoginBody,
  },
}, async (req, res) => {
  const id = uuid.v4();
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });
  clients.set(id, client);
  const loginPromise = client.start({
    phoneNumber: req.body.phoneNumber,
    password: async () => req.body.password || '',
    phoneCode: () => {
      return new Promise<string>((resolve) => {
        phoneCodeResolvers.set(id, resolve);
      });
    },
    onError: (err) => server.log.error(err),
  });
  loginPromises.set(id, loginPromise);
  return {
    id,
  };
});

const PhoneCodeBody = Type.Object({
  id: Type.String(),
  phoneCode: Type.String(),
});
type PhoneCodeBodyType = Static<typeof PhoneCodeBody>;

server.post<{ Body: PhoneCodeBodyType; }>('/phoneCode', {
  schema: {
    body: PhoneCodeBody,
  },
}, async (req, res) => {
  const id = req.body.id;
  const client = clients.get(id);
  const phoneCodeResolver = phoneCodeResolvers.get(id);
  const loginPromise = loginPromises.get(id);

  if (client === undefined || phoneCodeResolver === undefined || loginPromise === undefined) {
    res.status(400);
    return {
      id,
      error: 'Please call login first',
    };
  }

  phoneCodeResolver(req.body.phoneCode);

  await loginPromise;

  const sessionString = client.session.save();

  await client.disconnect();
  clients.delete(id);
  phoneCodeResolvers.delete(id);
  loginPromises.delete(id);

  return {
    id,
    sessionString,
  };
});

const SendMessageBody = Type.Object({
  sessionString: Type.String(),
  to: Type.String(),
  message: Type.String(),
});
type SendMessageBodyType = Static<typeof SendMessageBody>;

server.post<{ Body: SendMessageBodyType; }>('/sendMessage', async (req, res) => {
  try {
    const client = new TelegramClient(new StringSession(req.body.sessionString), apiId, apiHash, {
      connectionRetries: 5,
    });
    await client.connect();
    await client.sendMessage(req.body.to, { message: req.body.message });
    await client.disconnect();
  } catch (e) {
    server.log.error(e);
    res.status(500);
    return false;
  }
  return true;
});

(async () => {
  await server.listen(3000, '0.0.0.0');
})().catch(e => {
  server.log.error(e);
  process.exit(1);
});

/*
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

const apiId = 8785191;
const apiHash = "2d992b9e1de1379ee28e9d027fc3b716";
const stringSession = new StringSession("1AQAOMTQ5LjE1NC4xNzUuNTkBu6zPQwwIcZOUjxXlJnzkdHYcXTjWz4fvdmqET5FvtLYenYpIS8Xx2glqy6QIlVX+qYfDdTcTdapuwvkXFz3eiAl9iKhe/i3ZqJIQrKw6l0GdPcdmLhsVS21VOQFhNGCveXB9qQaA0v6w7GYwRrsyaB+3MWOkSZOwTu5sZbxWm6N34jyF8TndBf4JsDIEaiJdXWreGnDlevFAzfUx0xYcXg8oToAe3asH+sufEvvHMwB6Y33QFEJ/YpOHkGD5nXqwoWcztZ028POAlpFClrGJqJ5nMs1jpskoKMUUsqq79geqoUytF85Src25VBqIsn+B9a2RkODrqs88SPQKdEpvPxY=");

(async () => {
  console.log("Loading interactive example...");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.start({
    phoneNumber: async () => await '+15855327962',
    password: async () => await '',
    phoneCode: async () => await '1234',
    onError: (err) => console.log(err),
  });
  console.log("You should now be connected.");
  console.log(client.session.save()); // Save this string to avoid logging in again
  await client.sendMessage("me", { message: "Hello!" });
  await client.disconnect();
})();
*/
