export interface UserProfile {
  uid: string;
  username: string;
  email: string;
  avatarUrl?: string;
  theme: string;
  createdAt: string;
  settings: {
    emailNotifications: boolean;
    darkMode: boolean;
  };
}

export interface CardElement {
  id: string;
  type: 'text' | 'button' | 'image' | 'gallery' | 'section' | 'dropdown' | 'tags' | 'embed' | 'countdown' | 'visitor' | 'mood' | 'anon_box';
  content: any;
  style: any;
}

export interface CardData {
  uid: string;
  username: string;
  profile?: {
    displayName?: string;
    avatarUrl?: string;
  };
  published_content: {
    elements: CardElement[];
    styles: any;
  };
  draft_content: {
    elements: CardElement[];
    styles: any;
  };
  updatedAt: string;
}

export interface AnonResponse {
  id: string;
  cardId: string;
  message: string;
  createdAt: string;
  status: 'unread' | 'archived' | 'deleted';
  reply?: string;
}
