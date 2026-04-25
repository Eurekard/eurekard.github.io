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
  type: 'text' | 'button' | 'image' | 'gallery' | 'section' | 'dropdown' | 'tags' | 'embed' | 'music' | 'countdown' | 'visitor' | 'mood' | 'anon_box';
  content: any;
  style: any;
}

export interface ElementVisualStyle {
  useGlobalStyle?: boolean;
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'wavy';
  textAlign?: 'left' | 'center' | 'right';
  radius?: number;
}

export interface GlobalDesignStyles {
  backgroundImageUrl?: string;
  backgroundColor?: string;
  backgroundRepeat?: 'repeat' | 'no-repeat';
  backgroundSize?: 'cover' | 'contain' | 'auto' | 'stretch';
  fontFamily?: 'noto-sans-tc' | 'noto-serif-tc' | 'chiron-goround-tc' | 'lxgw-wenkai-tc' | 'system';
  palette?: string[];
  textColor?: string;
  componentBackgroundColor?: string;
  componentBackgroundOpacity?: number;
  componentBorderColor?: string;
  componentBorderWidth?: number;
  componentBorderStyle?: 'solid' | 'dashed' | 'dotted' | 'double';
  componentBorderRadius?: number;
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
    styles: GlobalDesignStyles;
  };
  draft_content: {
    elements: CardElement[];
    styles: GlobalDesignStyles;
  };
  interactions?: {
    responsesEnabled?: boolean;
  };
  updatedAt: string;
}

export interface AnonResponse {
  id: string;
  cardId: string;
  message: string;
  createdAt: string;
  status: 'unread' | 'replied' | 'archived' | 'deleted';
  reply?: string;
}
