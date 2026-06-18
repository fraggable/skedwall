import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { GeneratedImageStatus, WallpaperMode } from "@/generated/prisma/client";
import {
  fetchCalendarDays,
  getDateAtUtcMidnight,
  getTodayKey,
} from "@/lib/calendar";
import { prisma } from "@/lib/prisma";
import {
  createSupabaseAdminClient,
  getStorageBucket,
} from "@/lib/supabase-admin";

function getFileExtension(storagePath: string) {
  const extension = path.extname(storagePath).toLowerCase();
  return extension || ".jpg";
}

function runRenderer(inputPath: string, outputPath: string, clean = false) {
  return new Promise<void>((resolve, reject) => {
    const python = process.env.PYTHON_BIN ?? "python";
    const rendererPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "python-renderer", "render.py");
    const args = [
      rendererPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
    ];

    if (clean) {
      args.push("--clean");
    }

    const child = spawn(python, args);

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `Renderer exited with code ${code}`));
    });
  });
}

async function selectWallpaper(
  userId: string,
  mode: WallpaperMode,
  selectedWallpaperId: string | null,
  dateKey: string,
) {
  const enabledWallpapers = await prisma.wallpaper.findMany({
    where: {
      userId,
      isEnabled: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (enabledWallpapers.length === 0) {
    throw new Error("No enabled wallpapers are available");
  }

  if (mode === WallpaperMode.SELECTED && selectedWallpaperId) {
    const selected = enabledWallpapers.find(
      (wallpaper) => wallpaper.id === selectedWallpaperId,
    );

    if (selected) {
      return selected;
    }
  }

  if (mode === WallpaperMode.RANDOM_DAILY) {
    const date = getDateAtUtcMidnight(dateKey);
    const existingSelection = await prisma.dailyWallpaperSelection.findUnique({
      where: {
        userId_date: {
          userId,
          date,
        },
      },
      include: {
        wallpaper: true,
      },
    });

    if (existingSelection?.wallpaper.isEnabled) {
      return existingSelection.wallpaper;
    }

    const wallpaper =
      enabledWallpapers[Math.floor(Math.random() * enabledWallpapers.length)];

    await prisma.dailyWallpaperSelection.upsert({
      where: {
        userId_date: {
          userId,
          date,
        },
      },
      create: {
        userId,
        wallpaperId: wallpaper.id,
        date,
      },
      update: {
        wallpaperId: wallpaper.id,
      },
    });

    return wallpaper;
  }

  return enabledWallpapers[0];
}

export async function generateWallpaperForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { settings: true },
  });

  if (!user?.settings) {
    throw new Error("User settings are missing");
  }

  const dateKey = getTodayKey(user.settings.timezone);

  try {
    const wallpaper = await selectWallpaper(
      user.id,
      user.settings.wallpaperMode,
      user.settings.selectedWallpaperId,
      dateKey,
    );
    const supabase = createSupabaseAdminClient();
    const bucket = getStorageBucket();
    const tempRoot = path.join(tmpdir(), "skedwall", user.id, dateKey);

    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });

    const basePath = path.join(
      tempRoot,
      `base${getFileExtension(wallpaper.storagePath)}`,
    );
    const inputPath = path.join(tempRoot, "input.json");
    const outputPath = path.join(tempRoot, "today.jpg");
    const cleanOutputPath = path.join(tempRoot, "home.jpg");
    const { data: baseImage, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(wallpaper.storagePath);

    if (downloadError || !baseImage) {
      throw new Error(downloadError?.message ?? "Wallpaper download failed");
    }

    await writeFile(basePath, Buffer.from(await baseImage.arrayBuffer()));

    const days = await fetchCalendarDays(
      user.id,
      user.settings.timezone,
      user.settings.maxEvents,
    );

    await writeFile(
      inputPath,
      JSON.stringify(
        {
          timezone: user.settings.timezone,
          days,
          baseWallpaperPath: basePath,
          width: 1290,
          height: 2796,
        },
        null,
        2,
      ),
    );

    await runRenderer(inputPath, outputPath);
    await runRenderer(inputPath, cleanOutputPath, true);

    const outputBuffer = await readFile(outputPath);
    const cleanOutputBuffer = await readFile(cleanOutputPath);
    const generatedPath = `users/${user.id}/generated/today.jpg`;
    const homePath = `users/${user.id}/generated/home.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(generatedPath, outputBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { error: homeUploadError } = await supabase.storage
      .from(bucket)
      .upload(homePath, cleanOutputBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (homeUploadError) {
      throw new Error(homeUploadError.message);
    }

    const image = await prisma.generatedImage.create({
      data: {
        userId: user.id,
        wallpaperId: wallpaper.id,
        storagePath: generatedPath,
        date: getDateAtUtcMidnight(dateKey),
        status: GeneratedImageStatus.SUCCESS,
      },
    });

    return image;
  } catch (error) {
    await prisma.generatedImage.create({
      data: {
        userId: user.id,
        storagePath: "",
        date: getDateAtUtcMidnight(dateKey),
        status: GeneratedImageStatus.FAILED,
        errorMessage:
          error instanceof Error ? error.message : "Unknown generation error",
      },
    });

    throw error;
  }
}
