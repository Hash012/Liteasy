export type ForumContext = {
  anchorHash?: string;
  citationEnabled?: boolean;
  excerpt?: string;
  language: string;
  page?: number;
  topicId: string;
  workId?: string;
};

export type ForumDraftUpdate = {
  body: string;
  citationEnabled: boolean;
  tags?: string[];
  title?: string;
};

export type ForumFeedQuery = {
  anchorHash?: string;
  workId: string;
};

export type ForumPost = {
  author_name: string;
  body: string;
  created_at: string;
  helpful: number;
  id: string;
  work_id: string | null;
  tags: string[];
  title: string | null;
  viewer_saved: boolean;
};
