/**
 * 管理端点配置 API
 * GET    /api/admin/platform/endpoints - 列出所有端点
 * POST   /api/admin/platform/endpoints - 创建新端点
 * PUT    /api/admin/platform/endpoints - 更新端点
 * DELETE /api/admin/platform/endpoints?id=xxx - 删除端点
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registry } from "@/lib/adapters/registry";
import type { EndpointConfig } from "@/lib/adapters/types";

async function isAdmin(request: NextRequest): Promise<boolean> {
  const session = request.cookies.get("session")?.value;
  if (!session) return false;
  try {
    const user = await db.oneOrNone(
      "SELECT role FROM users WHERE session_token = $1",
      [session]
    );
    return user?.role >= 10;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const endpoints = await db.any<EndpointConfig>(
      "SELECT * FROM lfn_endpoints ORDER BY type, priority DESC, created_at DESC"
    );
    return NextResponse.json({ endpoints });
  } catch (error) {
    console.error("Failed to fetch endpoints:", error);
    return NextResponse.json(
      { error: "Failed to fetch endpoints" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, adapterType, name, config, priority = 0 } = body;

    if (!type || !adapterType || !name || !config) {
      return NextResponse.json(
        { error: "Missing required fields: type, adapterType, name, config" },
        { status: 400 }
      );
    }

    if (!["auth", "image", "wallet"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid type. Must be: auth, image, or wallet" },
        { status: 400 }
      );
    }

    const id = `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const endpoint = await db.one<EndpointConfig>(
      `INSERT INTO lfn_endpoints (id, type, adapter_type, name, enabled, config, priority, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, $5, $6, NOW(), NOW())
       RETURNING *`,
      [id, type, adapterType, name, JSON.stringify(config), priority]
    );

    // 重新加载适配器
    await registry.reload();

    return NextResponse.json({ endpoint });
  } catch (error) {
    console.error("Failed to create endpoint:", error);
    return NextResponse.json(
      { error: "Failed to create endpoint" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, name, config, enabled, priority } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing endpoint id" }, { status: 400 });
    }

    const sets: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (config !== undefined) {
      params.push(JSON.stringify(config));
      sets.push(`config = $${params.length}`);
    }
    if (enabled !== undefined) {
      params.push(enabled);
      sets.push(`enabled = $${params.length}`);
    }
    if (priority !== undefined) {
      params.push(priority);
      sets.push(`priority = $${params.length}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    sets.push(`updated_at = NOW()`);
    params.push(id);

    const endpoint = await db.one<EndpointConfig>(
      `UPDATE lfn_endpoints SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    // 重新加载适配器
    await registry.reload();

    return NextResponse.json({ endpoint });
  } catch (error) {
    console.error("Failed to update endpoint:", error);
    return NextResponse.json(
      { error: "Failed to update endpoint" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing endpoint id" }, { status: 400 });
    }

    await db.none("DELETE FROM lfn_endpoints WHERE id = $1", [id]);

    // 重新加载适配器
    await registry.reload();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete endpoint:", error);
    return NextResponse.json(
      { error: "Failed to delete endpoint" },
      { status: 500 }
    );
  }
}
