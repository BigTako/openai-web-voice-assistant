import { io } from 'socket.io-client';

const wsHost = import.meta.env.VITE_WS_HOST;

export const socket = io(wsHost, {
  transports: ['websocket'],
});
