import { io } from 'socket.io-client';

// Conecta na mesma origem da página: em dev o Vite proxeia /socket.io para o
// Fastify (3100); em prod o próprio Fastify serve tudo no mesmo processo.
export const socket = io({ autoConnect: false });
