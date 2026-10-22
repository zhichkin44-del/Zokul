export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  createdAt: string;
  isAgent?: boolean;
  lastSeenAt?: string;
  role?: 'admin' | 'user';
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  avatar_url: string | null;
  created_at: string;
  token_version: number;
  is_agent?: boolean;
  last_seen_at?: string | null;
  role?: 'admin' | 'user';
  blocked?: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface Chat {
  id: string;
  name?: string;
  isGroup?: boolean;
  creatorId?: string;
  participantIds: string[];
  createdAt: string;
}

export interface ChatWithUsers extends Chat {
  participants: User[];
  lastMessage?: Message;
  // For the user who loaded the chat: notifications off.
  muted?: boolean;
}

export interface ChatRow {
  id: string;
  name: string | null;
  is_group: boolean;
  creator_id: string | null;
  created_at: string;
  last_message_id?: string;
  last_message_text?: string;
  last_message_image_url?: string;
  last_message_created_at?: string;
  last_message_sender_id?: string;
  user_id: string;
  user_email: string;
  user_name: string;
  user_avatar_url: string | null;
  user_created_at: string;
  user_is_agent?: boolean;
  user_last_seen_at?: string | null;
  user_muted?: boolean;
  last_message_file_name?: string | null;
  last_message_kind?: string | null;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text?: string;
  imageUrl?: string;
  imageUrls?: string[];
  voiceUrl?: string;
  voiceDuration?: number;
  replyTo?: ReplyPreview;
  isEdited?: boolean;
  createdAt: string;
  kind?: MessageKind;
  payload?: Record<string, unknown>;
  file?: FileAttachment;
}

export interface FileAttachment {
  url: string;
  name: string;
  size: number;
  mime: string;
}

// 'text' is a normal chat message; the others are cards posted by AI agents.
export type MessageKind = 'text' | 'status' | 'question' | 'handoff';

export interface ReplyPreview {
  messageId: string;
  senderId: string;
  senderName: string;
  text?: string;
  imageUrl?: string;
}

export interface ReadReceipt {
  messageId: string;
  userId: string;
  readAt: string;
}
