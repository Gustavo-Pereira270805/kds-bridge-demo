import {Server, Socket} from 'socket.io';

export function registerSocketHandlers(io: Server) {
    io.on('connection', (socket: Socket) => {
        console.log(`[Socket.io] Nova Conexão Estabelecida: ${socket.id}`);

        socket.on('identify', (profile: string) => {
            socket.join(profile);
            console.log(`[Socket.io] Socket ${socket.id} registou-se na sala: ${profile}`);
        });

        socket.on('disconnect', () => {
            console.log(`[socket.io] Conexão Encerrada: ${socket.id}`);
        });
    });
}