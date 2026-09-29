import type { ExtendedError, Socket } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.js";

// The socket equivalent of req.auth — populated once per connection (see index.ts's io.use), read when
// the connection handler joins the user's room, and available to any future event handler on this socket.
export interface SocketData {
  userId: string;
  userType: "user" | "admin";
  role: string;
}

export async function socketAuthenticate(
  socket: Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>,
  next: (err?: ExtendedError) => void,
) {
  const token = socket.handshake.auth?.token;

  if (typeof token !== "string" || !token) {
    next(new Error("Missing authentication token"));
    return;
  }

  try {
    const payload = await verifyAccessToken(token);
    socket.data.userId = payload.sub;
    socket.data.userType = payload.userType;
    socket.data.role = payload.role;
    next();
  } catch {
    next(new Error("Invalid or expired access token"));
  }
}
