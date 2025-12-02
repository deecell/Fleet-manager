import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface OrgContextType {
  organizationId: string | null;
  setOrganizationId: (id: number | string | null) => void;
}

const OrgContext = createContext<OrgContextType | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [organizationId, setOrgId] = useState<string | null>(null);

  const setOrganizationId = useCallback((id: number | string | null) => {
    setOrgId(id ? String(id) : null);
  }, []);

  return (
    <OrgContext.Provider value={{ organizationId, setOrganizationId }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrganization must be used within an OrgProvider");
  }
  return context;
}
