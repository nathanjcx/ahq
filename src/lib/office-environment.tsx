import { createContext, useContext } from 'react';

export type OfficeEnvironment = {
  api: Window['ahq'];
  isDemo: boolean;
};

const OfficeEnvironmentContext = createContext<OfficeEnvironment>({
  get api() {
    return typeof window === 'undefined' ? undefined : window.ahq;
  },
  isDemo: false,
});

export const OfficeEnvironmentProvider = OfficeEnvironmentContext.Provider;

export function useOfficeEnvironment() {
  return useContext(OfficeEnvironmentContext);
}
