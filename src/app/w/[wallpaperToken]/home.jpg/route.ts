import { GeneratedImageStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createSupabaseAdminClient,
  getStorageBucket,
} from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ wallpaperToken: string }> },
) {
  const { wallpaperToken } = await context.params;
  const settings = await prisma.userSettings.findUnique({
    where: { wallpaperToken },
    include: {
      user: {
        include: {
          generatedImages: {
            where: {
              status: GeneratedImageStatus.SUCCESS,
              storagePath: { not: "" },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  const image = settings?.user.generatedImages[0];

  if (!settings || !image) {
    return new Response("No generated wallpaper is available yet.", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const storagePath = `users/${settings.user.id}/generated/home.jpg`;
  const { data, error } = await createSupabaseAdminClient()
    .storage.from(getStorageBucket())
    .download(storagePath);

  if (error || !data) {
    return new Response("Clean wallpaper could not be loaded.", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(Buffer.from(await data.arrayBuffer()), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}