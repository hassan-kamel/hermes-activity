/**
 * Minimal type declarations for the parts of `@hermes/plugin-sdk` this plugin uses.
 * The SDK is provided by Hermes Desktop at runtime; there is no npm package.
 * Source of truth: hermes-agent `apps/desktop/src/sdk/index.ts` and
 * `website/docs/developer-guide/desktop-plugin-sdk.md`.
 */
declare module "@hermes/plugin-sdk" {
  import type { ComponentType, CSSProperties, ReactNode } from "react";

  export interface ReadableAtom<T> {
    get(): T;
  }

  export interface Contribution {
    id: string;
    area: string;
    order?: number;
    title?: string;
    render?: () => ReactNode;
    data?: unknown;
  }

  export interface PluginContext {
    register(c: Contribution): () => void;
    storage: {
      get(key: string): string | null | undefined;
      set(key: string, value: string): void;
    };
  }

  export interface FocusedSessionOwner {
    connectionId: string;
    profile: string;
  }

  export interface ProfileRoute {
    connectionId: string;
    mode: "local" | "remote";
    primary?: true;
    profile: string;
    targetProfile: string;
  }

  export const host: {
    state: {
      busy: ReadableAtom<boolean>;
      focusedSessionOwner: ReadableAtom<FocusedSessionOwner | null>;
      profile: ReadableAtom<string | null | undefined>;
    };
    navigate(path: string): void;
    openSession?(storedSessionId: string): Promise<void>;
    profileRoutes(): Promise<ProfileRoute[]>;
    requestProfile<T>(route: ProfileRoute, method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  };

  export function useValue<T>(atom: ReadableAtom<T>): T;

  export interface QueryResult<T> {
    data: T | undefined;
    error: unknown;
    isLoading: boolean;
    isFetching: boolean;
    refetch(): Promise<unknown>;
  }
  export function useQuery<T>(opts: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<T>;
    staleTime?: number;
    gcTime?: number;
    enabled?: boolean;
    retry?: number | boolean;
    refetchOnWindowFocus?: boolean;
    placeholderData?: (prev: T | undefined) => T | undefined;
  }): QueryResult<T>;
  export function useQueryClient(): {
    invalidateQueries(opts: { queryKey: readonly unknown[] }): Promise<void>;
  };

  export const ROUTES_AREA: string;
  export const SIDEBAR_NAV_AREA: string;
  export const PALETTE_AREA: string;
  export const STATUSBAR_AREAS: { left: string; right: string };

  export function SegmentedControl<T extends string>(props: {
    value: T;
    onChange: (id: T) => void;
    options: { id: T; label: string }[];
    className?: string;
    disabled?: boolean;
  }): ReactNode;
  export const Skeleton: ComponentType<{ className?: string; style?: CSSProperties }>;
  export const Tip: ComponentType<{ label: ReactNode; children: ReactNode; delayDuration?: number }>;
  export const Codicon: ComponentType<{ name: string; className?: string; size?: number | string; spinning?: boolean }>;
}
