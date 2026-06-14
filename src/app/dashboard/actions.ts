"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { WallpaperMode } from "@/generated/prisma/client";
import { generateWallpaperForUser } from "@/lib/generation";
import { prisma } from "@/lib/prisma";
import {
  createSupabaseAdminClient,
  getStorageBucket,
} from "@/lib/supabase-admin";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function getCurrentUser() {
  const session = await auth();

  if (!session?.user?.email) {
    throw new Error("You must be signed in");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    throw new Error("User was not found");
  }

  return user;
}

function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "Asia/Manila";
  }
}

function getFileExtension(file: File) {
  if (file.type === "image/png") {
    return "png";
  }

  if (file.type === "image/webp") {
    return "webp";
  }

  return "jpg";
}

export async function updateSettings(formData: FormData) {
  const user = await getCurrentUser();
  const mode = String(formData.get("wallpaperMode"));
  const selectedWallpaperId = String(formData.get("selectedWallpaperId") ?? "");
  const maxEvents = Number(formData.get("maxEvents"));
  const timezone = validateTimezone(String(formData.get("timezone") ?? ""));
  const generationEnabled = formData.get("generationEnabled") === "on";
  const nextMode = Object.values(WallpaperMode).includes(mode as WallpaperMode)
    ? (mode as WallpaperMode)
    : WallpaperMode.LATEST_UPLOADED;
  const selectedWallpaper =
    selectedWallpaperId &&
    (await prisma.wallpaper.findFirst({
      where: {
        id: selectedWallpaperId,
        userId: user.id,
        isEnabled: true,
      },
    }));

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      timezone,
      maxEvents: Number.isFinite(maxEvents)
        ? Math.min(Math.max(Math.trunc(maxEvents), 1), 6)
        : 6,
      wallpaperMode: nextMode,
      selectedWallpaperId: selectedWallpaper ? selectedWallpaper.id : null,
      generationEnabled,
    },
    update: {
      timezone,
      maxEvents: Number.isFinite(maxEvents)
        ? Math.min(Math.max(Math.trunc(maxEvents), 1), 6)
        : 6,
      wallpaperMode: nextMode,
      selectedWallpaperId: selectedWallpaper ? selectedWallpaper.id : null,
      generationEnabled,
    },
  });

  revalidatePath("/dashboard");
}

export type UploadWallpaperState = {
  error?: string;
  success?: string;
};

export async function uploadWallpaper(
  _previousState: UploadWallpaperState,
  formData: FormData,
): Promise<UploadWallpaperState> {
  try {
    const user = await getCurrentUser();
    const file = formData.get("wallpaper");

    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose an image file before uploading." };
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Only JPEG, PNG, and WebP images are supported." };
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return { error: "Wallpaper image must be 10 MB or smaller." };
    }

    const wallpaperId = randomUUID();
    const storagePath = `users/${user.id}/wallpapers/${wallpaperId}.${getFileExtension(
      file,
    )}`;
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage
      .from(getStorageBucket())
      .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      return { error: error.message };
    }

    await prisma.wallpaper.create({
      data: {
        id: wallpaperId,
        userId: user.id,
        storagePath,
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      },
    });

    revalidatePath("/dashboard");
    return { success: "Wallpaper uploaded." };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Upload failed.",
    };
  }
}

export async function setWallpaperEnabled(formData: FormData) {
  const user = await getCurrentUser();
  const id = String(formData.get("wallpaperId") ?? "");
  const isEnabled = formData.get("isEnabled") === "true";

  await prisma.wallpaper.updateMany({
    where: {
      id,
      userId: user.id,
    },
    data: {
      isEnabled,
    },
  });

  revalidatePath("/dashboard");
}

export async function deleteWallpaper(formData: FormData) {
  const user = await getCurrentUser();
  const id = String(formData.get("wallpaperId") ?? "");
  const wallpaper = await prisma.wallpaper.findFirst({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!wallpaper) {
    throw new Error("Wallpaper was not found");
  }

  await createSupabaseAdminClient()
    .storage.from(getStorageBucket())
    .remove([wallpaper.storagePath]);

  await prisma.wallpaper.delete({
    where: {
      id: wallpaper.id,
    },
  });

  revalidatePath("/dashboard");
}

export async function regenerateWallpaperToken() {
  const user = await getCurrentUser();

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      wallpaperToken: randomUUID(),
    },
    update: {
      wallpaperToken: randomUUID(),
    },
  });

  revalidatePath("/dashboard");
}

export type GenerateWallpaperState = {
  error?: string;
  success?: string;
};

export async function generateTodayWallpaper(
  _previousState: GenerateWallpaperState,
): Promise<GenerateWallpaperState> {
  void _previousState;

  try {
    const user = await getCurrentUser();

    await generateWallpaperForUser(user.id);
    revalidatePath("/dashboard");
    return { success: "Wallpaper generated." };
  } catch (error) {
    revalidatePath("/dashboard");
    return {
      error:
        error instanceof Error ? error.message : "Wallpaper generation failed.",
    };
  }
}

