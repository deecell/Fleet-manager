import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./queryClient";

interface User {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  organizationId: number;
  organizationName: string | null;
}

interface SessionResponse {
  authenticated: boolean;
  user?: User;
}

interface LoginResponse {
  success: boolean;
  message: string;
  user?: User;
}

export function useSession() {
  return useQuery<SessionResponse>({
    queryKey: ["/api/auth/session"],
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", credentials);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Login failed");
      }
      return data as LoginResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/logout", {});
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Logout failed");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
