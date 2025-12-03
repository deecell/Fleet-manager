import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, ExternalLink, RefreshCw, Bug, Lightbulb, Wrench, AlertCircle } from "lucide-react";

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  created_at: string;
  labels: { name: string; color: string }[];
}

interface GitHubLabel {
  name: string;
  color: string;
}

const ISSUE_TEMPLATES = [
  {
    name: "Bug Report",
    icon: Bug,
    labels: ["bug"],
    bodyTemplate: `## Description
[Describe the bug]

## Steps to Reproduce
1. 
2. 
3. 

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Environment
- Browser: 
- Device: 
`,
  },
  {
    name: "Feature Request",
    icon: Lightbulb,
    labels: ["enhancement"],
    bodyTemplate: `## Feature Description
[Describe the feature]

## Use Case
[Why is this needed]

## Proposed Solution
[How should it work]
`,
  },
  {
    name: "Technical Debt",
    icon: Wrench,
    labels: ["tech-debt"],
    bodyTemplate: `## Issue
[Describe the technical debt]

## Impact
[How does this affect the codebase]

## Proposed Fix
[How to address it]
`,
  },
];

export default function IssuesPage() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const { data: issuesData, isLoading: issuesLoading, refetch: refetchIssues } = useQuery<{ issues: GitHubIssue[] }>({
    queryKey: ["/api/v1/admin/github/issues"],
  });

  const { data: labelsData } = useQuery<{ labels: GitHubLabel[] }>({
    queryKey: ["/api/v1/admin/github/labels"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; body: string; labels: string[] }) => {
      const response = await apiRequest("POST", "/api/v1/admin/github/issues", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Issue Created",
        description: `Issue #${data.issue.number} created successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/github/issues"] });
      setIsCreateOpen(false);
      resetForm();
      if (data.issue.html_url) {
        window.open(data.issue.html_url, "_blank");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create issue",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setTitle("");
    setBody("");
    setSelectedLabels([]);
  };

  const applyTemplate = (template: typeof ISSUE_TEMPLATES[0]) => {
    setBody(template.bodyTemplate);
    setSelectedLabels(template.labels);
  };

  const toggleLabel = (labelName: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelName)
        ? prev.filter((l) => l !== labelName)
        : [...prev, labelName]
    );
  };

  const handleCreate = () => {
    if (!title.trim()) {
      toast({
        title: "Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({ title, body, labels: selectedLabels });
  };

  const issues = issuesData?.issues || [];
  const labels = labelsData?.labels || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">GitHub Issues</h1>
          <p className="text-muted-foreground">
            Track bugs, features, and tasks for deecell/Fleet-manager
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetchIssues()}
            data-testid="button-refresh-issues"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-issue">
                <Plus className="h-4 w-4 mr-2" />
                New Issue
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create GitHub Issue</DialogTitle>
                <DialogDescription>
                  Create a new issue in deecell/Fleet-manager
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-2">
                  {ISSUE_TEMPLATES.map((template) => (
                    <Button
                      key={template.name}
                      variant="outline"
                      size="sm"
                      onClick={() => applyTemplate(template)}
                      data-testid={`button-template-${template.name.toLowerCase().replace(' ', '-')}`}
                    >
                      <template.icon className="h-4 w-4 mr-1" />
                      {template.name}
                    </Button>
                  ))}
                </div>
                <div>
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Issue title"
                    data-testid="input-issue-title"
                  />
                </div>
                <div>
                  <Label htmlFor="body">Description</Label>
                  <Textarea
                    id="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Describe the issue..."
                    className="min-h-[200px] font-mono text-sm"
                    data-testid="input-issue-body"
                  />
                </div>
                <div>
                  <Label>Labels</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {labels.map((label) => (
                      <Badge
                        key={label.name}
                        variant={selectedLabels.includes(label.name) ? "default" : "outline"}
                        className="cursor-pointer"
                        style={{
                          backgroundColor: selectedLabels.includes(label.name)
                            ? `#${label.color}`
                            : undefined,
                          borderColor: `#${label.color}`,
                        }}
                        onClick={() => toggleLabel(label.name)}
                        data-testid={`badge-label-${label.name}`}
                      >
                        {label.name}
                      </Badge>
                    ))}
                    {labels.length === 0 && (
                      <span className="text-sm text-muted-foreground">
                        No labels available
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-issue"
                >
                  {createMutation.isPending ? "Creating..." : "Create Issue"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Open Issues
          </CardTitle>
          <CardDescription>
            {issues.length} open issue{issues.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {issuesLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading issues...
            </div>
          ) : issues.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No open issues. Create one to get started!
            </div>
          ) : (
            <div className="space-y-3">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start justify-between p-4 border rounded-lg hover-elevate"
                  data-testid={`issue-row-${issue.number}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">
                        #{issue.number}
                      </span>
                      <a
                        href={issue.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline truncate"
                        data-testid={`link-issue-${issue.number}`}
                      >
                        {issue.title}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {issue.labels.map((label) => (
                        <Badge
                          key={label.name}
                          variant="outline"
                          style={{
                            borderColor: `#${label.color}`,
                            color: `#${label.color}`,
                          }}
                          className="text-xs"
                        >
                          {label.name}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        opened {new Date(issue.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    data-testid={`button-open-issue-${issue.number}`}
                  >
                    <a href={issue.html_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
