// ── Harness-style Service Container (DI) ──────────────────────────────────
// Provides a lightweight dependency injection container where services are
// registered by token and resolved lazily. Supports singletons, factories,
// and lifecycle management.
//
// Pattern reference: Harness's service registry / DI system

export interface ServiceDescriptor<T> {
  token: string;
  factory: (container: ServiceContainer) => T;
  singleton: boolean;
  instance?: T;
}

export interface Initializable {
  initialize(): Promise<void>;
}

export interface Disposable {
  dispose(): Promise<void>;
}

export class ServiceContainer {
  private services = new Map<string, ServiceDescriptor<unknown>>();
  private initialized = false;
  private disposed = false;

  // ── Registration ──────────────────────────────────────────────────────

  /** Register a singleton service (created once, reused) */
  registerSingleton<T>(token: string, factory: (c: ServiceContainer) => T): ServiceContainer {
    this.services.set(token, { token, factory, singleton: true });
    return this;
  }

  /** Register a transient service (created fresh each time) */
  registerTransient<T>(token: string, factory: (c: ServiceContainer) => T): ServiceContainer {
    this.services.set(token, { token, factory, singleton: false });
    return this;
  }

  /** Register an already-created instance */
  registerInstance<T>(token: string, instance: T): ServiceContainer {
    this.services.set(token, { token, factory: () => instance, singleton: true, instance });
    return this;
  }

  // ── Resolution ────────────────────────────────────────────────────────

  /** Resolve a service by token. Throws if not found. */
  resolve<T>(token: string): T {
    const desc = this.services.get(token);
    if (!desc) throw new Error(`Service not registered: ${token}`);
    if (desc.singleton) {
      if (!desc.instance) desc.instance = desc.factory(this);
      return desc.instance as T;
    }
    return desc.factory(this) as T;
  }

  /** Resolve optionally — returns undefined if not registered */
  tryResolve<T>(token: string): T | undefined {
    try { return this.resolve<T>(token); } catch { return undefined; }
  }

  /** Check if a service is registered */
  has(token: string): boolean {
    return this.services.has(token);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Initialize all registered services that implement Initializable */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const desc of this.services.values()) {
      if (desc.singleton && !desc.instance) {
        desc.instance = desc.factory(this);
      }
      if (desc.instance && 'initialize' in (desc.instance as object)) {
        await (desc.instance as Initializable).initialize();
      }
    }
    this.initialized = true;
  }

  /** Dispose all services that implement Disposable */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    for (const desc of this.services.values()) {
      if (desc.instance && 'dispose' in (desc.instance as object)) {
        await (desc.instance as Disposable).dispose();
      }
    }
    this.services.clear();
    this.disposed = true;
  }

  /** Reset the container (for testing) */
  clear(): void {
    this.services.clear();
    this.initialized = false;
    this.disposed = false;
  }
}

// ── Well-known service tokens ────────────────────────────────────────────

export const TOKENS = {
  CONFIG: 'config',
  PROVIDER: 'provider',
  EVENT_BUS: 'eventBus',
  PIPELINE: 'pipeline',
  LOGGER: 'logger',
  TOOL_REGISTRY: 'toolRegistry',
  STAGE: (name: string) => `stage:${name}`,
} as const;
