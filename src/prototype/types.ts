export interface PrototypePage {
  id: string; // url-safe slug, used in links as href="#/<id>"
  name: string;
  html: string; // body markup only
  updatedAt?: string;
}

/** A reusable snippet the user generated and saved to the project library. */
export interface SavedComponent {
  id: string;
  name: string;
  html: string;
}

export interface Prototype {
  name: string;
  pages: PrototypePage[];
  components: SavedComponent[];
}
