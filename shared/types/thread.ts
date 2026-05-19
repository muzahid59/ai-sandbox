export interface Thread {
  id: string;
  title: string;
  status: 'active' | 'archived' | 'deleted';
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateThreadRequest {
  model: string;
  title?: string;
}

export interface UpdateThreadRequest {
  title?: string;
  status?: 'active' | 'archived';
}
