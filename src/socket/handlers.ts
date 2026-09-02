import { Server, Socket } from 'socket.io';
import { AuthUser } from '../types';
import { getUserByToken } from '../middleware/auth';

export const VALID_ROOMS = new Set([
  'salao',
  'cozinha_quente',
  'cozinha_fria',
  'cozinha_jantar',
  'cozinha',
  'gerente',
  'kds-pis',
]);

// Salas da cozinha são acessíveis sem autenticação (kiosks fixos);
// salão e gerente exigem token válido com o papel correspondente.
// Sala kds-pis é pública para heartbeat/power (Pi sem token) — emissão de pi:power só via HTTP com RBAC.
export function canJoinRoom(room: string, user: AuthUser | undefined): boolean {
  const kitchenRooms = ['cozinha', 'cozinha_quente', 'cozinha_fria', 'cozinha_jantar', 'kds-pis'];
  if (kitchenRooms.includes(room)) return true;
  if (!user) return false;
  if (room === 'salao') return user.role === 'salao' || user.role === 'gerente' || user.role === 'admin';
  if (room === 'gerente') return user.role === 'gerente' || user.role === 'admin';
  return false;
}

export function registerSocketHandlers(io: Server) {
  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? '';
    if (!token) {
      socket.data.user = undefined;
      next();
      return;
    }
    getUserByToken(token)
      .then((user) => {
        if (!user) {
          next(new Error('Autenticação inválida'));
          return;
        }
        socket.data.user = user;
        next();
      })
      .catch((err) => next(err));
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket.io] Nova Conexão Estabelecida: ${socket.id}`);

    socket.on('join', (room: string) => {
      if (VALID_ROOMS.has(room) && canJoinRoom(room, socket.data.user as AuthUser | undefined)) {
        socket.join(room);
        console.log(`[Socket.io] Socket ${socket.id} entrou na sala: ${room}`);
      }
    });

    socket.on('identify', (profile: string) => {
      if (VALID_ROOMS.has(profile) && canJoinRoom(profile, socket.data.user as AuthUser | undefined)) {
        socket.join(profile);
        console.log(`[Socket.io] Socket ${socket.id} registrou-se na sala: ${profile}`);
      }
    });

    socket.on('pi:heartbeat', (data: { hostname: string; at: string }) => {
      if (canJoinRoom('kds-pis', socket.data.user as AuthUser | undefined)) {
        io.to('gerente').to('kds-pis').emit('pi:heartbeat', data);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Conexão Encerrada: ${socket.id}`);
    });
  });
}
