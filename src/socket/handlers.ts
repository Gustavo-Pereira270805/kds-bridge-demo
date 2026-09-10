import { Server, Socket } from 'socket.io';
import { AuthUser } from '../types';
import { getUserByToken } from '../middleware/auth';
import { socketIp, isKioskIp } from '../middleware/kiosk';

export const VALID_ROOMS = new Set([
  'salao',
  'cozinha_quente',
  'cozinha_fria',
  'cozinha_jantar',
  'cozinha',
  'gerente',
  'kds-pis',
]);

// Salas da cozinha: só quiosque liberado (IP) ou gerente/admin.
// Salão e kds-pis seguem públicos (kiosk do salão e heartbeat dos Pis, sem token);
// gerente exige token válido com o papel correspondente.
const KITCHEN_ROOMS = ['cozinha', 'cozinha_quente', 'cozinha_fria', 'cozinha_jantar'];

export function canJoinRoom(room: string, user: AuthUser | undefined, isKiosk: boolean): boolean {
  if (KITCHEN_ROOMS.includes(room)) {
    if (isKiosk) return true;
    if (!user) return false;
    return user.role === 'gerente' || user.role === 'admin';
  }
  const publicRooms = ['salao', 'kds-pis'];
  if (publicRooms.includes(room)) return true;
  if (!user) return false;
  if (room === 'gerente') return user.role === 'gerente' || user.role === 'admin';
  return false;
}

export const lastHeartbeat = new Map<string, string>(); // hostname -> ISO at

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
    const kiosk = isKioskIp(socketIp(socket));

    socket.on('join', (room: string) => {
      if (VALID_ROOMS.has(room) && canJoinRoom(room, socket.data.user as AuthUser | undefined, kiosk)) {
        socket.join(room);
        console.log(`[Socket.io] Socket ${socket.id} entrou na sala: ${room}`);
      } else {
        console.log(`[Socket.io] join negado sala=${room} user=${(socket.data.user as AuthUser | undefined)?.role ?? 'anon'} id=${socket.id}`);
      }
    });

    socket.on('identify', (profile: string) => {
      if (VALID_ROOMS.has(profile) && canJoinRoom(profile, socket.data.user as AuthUser | undefined, kiosk)) {
        socket.join(profile);
        console.log(`[Socket.io] Socket ${socket.id} registrou-se na sala: ${profile}`);
      }
    });

    socket.on('pi:heartbeat', (data: { hostname: string; at: string }) => {
      if (!data?.hostname) return;
      if (!canJoinRoom('kds-pis', socket.data.user as AuthUser | undefined, kiosk)) return;
      const receivedAt = new Date().toISOString();
      const heartbeat = { ...data, at: receivedAt };
      lastHeartbeat.set(data.hostname, receivedAt);
      console.log(`[pi:heartbeat] ${data.hostname} clientAt=${data.at} receivedAt=${receivedAt} from ${socket.id}`);
      io.to('gerente').emit('pi:heartbeat', heartbeat);
      io.to('kds-pis').emit('pi:heartbeat', heartbeat);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Conexão Encerrada: ${socket.id}`);
    });
  });
}
