import { createContext } from 'react';

export const NodeActionsContext = createContext<{
  openDetails: (nodeId: string) => void;
}>({ openDetails: () => {} });
