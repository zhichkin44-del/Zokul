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

export interface AuthResponse {
  token: string;
  user: User;
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
  readBy?: string[];
  createdAt: string;
  // Cards posted by AI agents; absent for normal messages.
  kind?: 'status' | 'question' | 'handoff';
  payload?: StatusPayload | QuestionPayload | HandoffPayload;
  file?: FileAttachment;
}

export interface FileAttachment {
  url: string;
  name: string;
  size: number;
  mime: string;
}

export interface StatusPayload {
  state: 'working' | 'done' | 'failed' | 'info';
}

export interface QuestionPayload {
  question: string;
  options: string[];
  answer: string | null;
  answeredBy?: string;
  answeredAt?: string;
  cancelled?: boolean;
}

export interface HandoffPayload {
  title: string;
  summary?: string;
  done: string[];
  next: string[];
  files: string[];
  notes?: string;
  claimedBy: string | null;
  claimedAt?: string;
}

export interface Agent {
  id: string;
  name: string;
  chatId?: string;
  createdAt: string;
  lastUsedAt?: string;
}

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

export interface Chat {
  id: string;
  name?: string;
  isGroup?: boolean;
  creatorId?: string;
  participantIds: string[];
  participants: User[];
  lastMessage?: Message;
  unreadCount?: number;
  muted?: boolean;
  createdAt: string;
}

export interface ChatDeleted {
  chatId: string;
}
