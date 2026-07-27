import { Server, Socket } from 'socket.io';

const VALID_ROOMS = new Set([
  'salao',
  'cozinha_quente',
  'cozinha_fria',
  'gerente',
]);

export function registerSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket.io] Nova Conexão Estabelecida: ${socket.id}`);

    socket.on('join', (room: string) => {
      if (VALID_ROOMS.has(room)) {
        socket.join(room);
        console.log(`[Socket.io] Socket ${socket.id} entrou na sala: ${room}`);
      }
    });

    socket.on('identify', (profile: string) => {
      if (VALID_ROOMS.has(profile)) {
        socket.join(profile);
        console.log(`[Socket.io] Socket ${socket.id} registrou-se na sala: ${profile}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Conexão Encerrada: ${socket.id}`);
    });
  });
}