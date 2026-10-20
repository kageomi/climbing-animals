// Local PeerJS signalling server for the online e2e tests (open the game with ?peer=127.0.0.1:9000).
import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT ?? 9000);
PeerServer({ port, host: '127.0.0.1', path: '/' }, () => console.log(`peer server on 127.0.0.1:${port}`));
