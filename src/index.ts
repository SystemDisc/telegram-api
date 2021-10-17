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

const telegramLogger = server.log.child({ module: 'telegram' });
Object.assign(telegramLogger, { canSend: () => false });

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
    baseLogger: telegramLogger,
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
      baseLogger: telegramLogger,
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
  await server.listen(3000);
})().catch(e => {
  server.log.error(e);
  process.exit(1);
});
