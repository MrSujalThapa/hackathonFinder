export type CustomSourceMode = "static" | "playwright" | "rss" | "sitemap";
export type CustomSourceStatus =
  | "healthy"
  | "degraded"
  | "auth_required"
  | "failed"
  | "disabled"
  | "unknown";

export type CustomSourceSelectors = {
  cardSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
};

export type CustomSource = {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  listingUrl: string;
  mode: CustomSourceMode;
  enabled: boolean;
  locationScope: string;
  topicScope: string[];
  maxItems: number;
  status: CustomSourceStatus;
  lastCheckedAt: string | null;
  lastErrorSafe: string | null;
  selectors: CustomSourceSelectors;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomSourceInput = {
  name: string;
  slug?: string;
  listingUrl: string;
  mode?: CustomSourceMode;
  enabled?: boolean;
  locationScope?: string;
  topicScope?: string[];
  maxItems?: number;
};

export type UpdateCustomSourceInput = Partial<
  Pick<
    CreateCustomSourceInput,
    "name" | "listingUrl" | "mode" | "enabled" | "locationScope" | "topicScope" | "maxItems"
  >
> & {
  selectors?: CustomSourceSelectors;
};

export type CustomSourceHealthUpdate = {
  status: CustomSourceStatus;
  lastErrorSafe?: string | null;
  checkedAt?: string;
};
