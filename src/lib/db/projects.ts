import type { CreateProjectRequest, Project, UpdateProjectRequest } from "@/types/contracts";
import { HttpError } from "@/lib/api/http";
import { toProject } from "./mappers";
import { prisma } from "./prisma";

const DEMO_WORKSPACE_NAME = "Demo Workspace";

// The MVP has a single workspace with no auth. It is created on first use so
// no workspace ID is ever hardcoded.
export async function getDemoWorkspaceId(): Promise<string> {
  const existing = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.workspace.create({
    data: { name: DEMO_WORKSPACE_NAME },
    select: { id: true },
  });
  return created.id;
}

export async function listProjects(workspaceId?: string): Promise<Project[]> {
  const rows = await prisma.project.findMany({
    where: { workspaceId: workspaceId ?? (await getDemoWorkspaceId()) },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toProject);
}

export async function createProject(
  input: Required<CreateProjectRequest>,
): Promise<Project> {
  const row = await prisma.project.create({
    data: {
      workspaceId: await getDemoWorkspaceId(),
      name: input.name,
      description: input.description,
    },
  });
  return toProject(row);
}

export async function assertProjectExists(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new HttpError("NOT_FOUND", "Project not found");
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectRequest,
): Promise<Project> {
  await assertProjectExists(projectId);
  const row = await prisma.project.update({
    where: { id: projectId },
    data: { name: input.name },
  });
  return toProject(row);
}

// Deletes the project and, through the database cascade, all of its events.
export async function deleteProject(projectId: string): Promise<void> {
  const { count } = await prisma.project.deleteMany({ where: { id: projectId } });
  if (count === 0) throw new HttpError("NOT_FOUND", "Project not found");
}
