import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Loader2, User, Lock, Mail, Camera, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface UserProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  userEmail: string;
  organizationName: string;
}

export function UserProfileDialog({
  open,
  onOpenChange,
  userName,
  userEmail,
  organizationName,
}: UserProfileDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Fetch current profile to get profile picture URL
  const { data: profile } = useQuery({
    queryKey: ["/api/v1/auth/profile"],
    enabled: open,
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const response = await apiRequest("POST", "/api/v1/auth/change-password", data);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to change password");
      }
      return result;
    },
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to change password", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const uploadPictureMutation = useMutation({
    mutationFn: async (data: { imageData: string; contentType: string }) => {
      const response = await apiRequest("POST", "/api/v1/auth/profile-picture", data);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to upload profile picture");
      }
      return result;
    },
    onSuccess: () => {
      toast({ title: "Profile picture updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/profile"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to upload profile picture",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const deletePictureMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/v1/auth/profile-picture");
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to remove profile picture");
      }
      return result;
    },
    onSuccess: () => {
      toast({ title: "Profile picture removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/auth/profile"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove profile picture",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Only JPEG, PNG, GIF, and WebP images are allowed",
        variant: "destructive"
      });
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Profile picture must be less than 5MB",
        variant: "destructive"
      });
      return;
    }

    // Read file as base64
    const reader = new FileReader();
    reader.onload = () => {
      const imageData = reader.result as string;
      uploadPictureMutation.mutate({
        imageData,
        contentType: file.type
      });
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ 
        title: "All fields are required", 
        variant: "destructive" 
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({ 
        title: "Password must be at least 8 characters", 
        variant: "destructive" 
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({ 
        title: "New passwords do not match", 
        variant: "destructive" 
      });
      return;
    }

    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const profilePictureUrl = (profile as any)?.profilePictureUrl;
  const isUploading = uploadPictureMutation.isPending;
  const isDeleting = deletePictureMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            User Profile
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="profile" data-testid="tab-profile">Profile</TabsTrigger>
            <TabsTrigger value="password" data-testid="tab-password">Password</TabsTrigger>
          </TabsList>
          
          <TabsContent value="profile" className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-[#fafbfc] rounded-lg">
                <div className="relative group">
                  <Avatar className="w-16 h-16 border-2 border-white shadow-sm">
                    <AvatarImage src={profilePictureUrl} alt={userName} />
                    <AvatarFallback className="bg-[#303030] text-white text-lg">
                      {getInitials(userName)}
                    </AvatarFallback>
                  </Avatar>
                  
                  {/* Upload overlay */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    data-testid="button-upload-avatar"
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <Camera className="w-5 h-5 text-white" />
                    )}
                  </button>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                    data-testid="input-avatar-file"
                  />
                </div>
                
                <div className="flex-1">
                  <p className="font-medium text-neutral-950" data-testid="text-profile-name">{userName}</p>
                  <p className="text-sm text-[#4a5565]" data-testid="text-profile-org">{organizationName}</p>
                  
                  <div className="flex gap-2 mt-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="text-xs h-7"
                      data-testid="button-change-photo"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Camera className="w-3 h-3 mr-1" />
                          {profilePictureUrl ? "Change" : "Upload"}
                        </>
                      )}
                    </Button>
                    
                    {profilePictureUrl && (
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => deletePictureMutation.mutate()}
                        disabled={isDeleting}
                        className="text-xs h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                        data-testid="button-remove-photo"
                      >
                        {isDeleting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs text-[#4a5565]">Email</Label>
                <div className="flex items-center gap-2 p-3 bg-[#fafbfc] rounded-lg">
                  <Mail className="w-4 h-4 text-[#4a5565]" />
                  <span className="text-sm text-neutral-950" data-testid="text-profile-email">{userEmail}</span>
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="password" className="space-y-4 pt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword" className="text-sm">Current Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a5565]" />
                  <Input
                    id="currentPassword"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="pl-10 pr-10"
                    placeholder="Enter current password"
                    data-testid="input-current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a5565] hover:text-neutral-950"
                    data-testid="button-toggle-current-password"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-sm">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a5565]" />
                  <Input
                    id="newPassword"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pl-10 pr-10"
                    placeholder="Enter new password (min 8 characters)"
                    data-testid="input-new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a5565] hover:text-neutral-950"
                    data-testid="button-toggle-new-password"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm">Confirm New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4a5565]" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10"
                    placeholder="Confirm new password"
                    data-testid="input-confirm-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a5565] hover:text-neutral-950"
                    data-testid="button-toggle-confirm-password"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              <Button 
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending}
                className="w-full"
                data-testid="button-change-password"
              >
                {changePasswordMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Changing...
                  </>
                ) : (
                  "Change Password"
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
