'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  ServiceCollection,
  type ServiceIdentifier,
} from '../common/instantiation';

/**
 * React adapter for `ServiceCollection`: `ServicesProvider` builds the
 * collection once per subtree and hands it out through Context;
 * `useService(id)` is the function-component analogue of a
 * constructor-injected parameter.
 */

const ServiceCollectionContext = createContext<ServiceCollection | undefined>(
  undefined,
);

export interface ServiceRegistration<T = unknown> {
  readonly id: ServiceIdentifier<T>;
  readonly instance: T;
}

/**
 * Bootstraps every workbench service exactly once and provides them to
 * the subtree. Callers build the registration list with `useMemo`
 * (services are plain classes; construction can be expensive and must
 * not repeat every render) -- see `apps/docs/src/app/[lang]/ide/layout.tsx`
 * for the concrete list.
 */
export function ServicesProvider({
  registrations,
  children,
}: {
  readonly registrations: readonly ServiceRegistration[];
  readonly children: ReactNode;
}) {
  const services = useMemo(() => {
    const collection = new ServiceCollection();
    for (const registration of registrations) {
      collection.set(registration.id, registration.instance);
    }
    return collection;
  }, [registrations]);

  return (
    <ServiceCollectionContext.Provider value={services}>
      {children}
    </ServiceCollectionContext.Provider>
  );
}

export function useService<T>(id: ServiceIdentifier<T>): T {
  const services = useContext(ServiceCollectionContext);
  if (!services) {
    throw new Error(
      `useService("${id.serviceId}") called outside a ServicesProvider.`,
    );
  }
  if (!services.has(id)) {
    throw new Error(`No service registered for "${id.serviceId}".`);
  }
  return services.get(id) as T;
}
