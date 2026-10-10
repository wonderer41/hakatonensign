import { withErrorHandling } from "@/lib/api/http";
import { parseUuid } from "@/lib/api/validation";
import { deleteProject } from "@/lib/db/projects";

export const DELETE = withErrorHandling(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await deleteProject(parseUuid(id, "id"));
    return new Response(null, { status: 204 });
  },
);
