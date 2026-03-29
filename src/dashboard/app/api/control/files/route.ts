import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path') || '';

  const fullPath = path.resolve(PROJECT_ROOT, filePath);
  // Security: prevent traversal outside project
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return NextResponse.json({ error: 'Path outside project' }, { status: 403 });
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__')
        .map(e => ({ name: e.name, isDir: e.isDirectory(), size: e.isFile() ? fs.statSync(path.join(fullPath, e.name)).size : 0 }))
        .sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name));
      return NextResponse.json({ type: 'directory', path: filePath || '.', entries });
    }

    if (stat.size > 500000) {
      return NextResponse.json({ type: 'file', path: filePath, content: '[File too large to display]', size: stat.size });
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    return NextResponse.json({ type: 'file', path: filePath, content, size: stat.size });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 404 });
  }
}
