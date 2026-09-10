import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ViewerController } from './controller.js';

type ToolPayload = object;

function structured(payload: ToolPayload): Record<string, unknown> {
  return Array.isArray(payload) ? { items: payload } : payload as Record<string, unknown>;
}

function textResult(payload: ToolPayload) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: structured(payload),
  };
}

async function visualResult(controller: ViewerController, payload: ToolPayload, screenshot?: Buffer) {
  const image = screenshot || await controller.screenshot();
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
      { type: 'image' as const, data: image.toString('base64'), mimeType: 'image/png' },
    ],
    structuredContent: structured(payload),
  };
}

function errorResult(error: unknown) {
  return {
    isError: true as const,
    content: [{
      type: 'text' as const,
      text: error instanceof Error ? error.message : String(error),
    }],
  };
}

function guarded<TArgs, TResult>(handler: (args: TArgs) => Promise<TResult>) {
  return async (args: TArgs) => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export function createMcpServer(controller: ViewerController): McpServer {
  const server = new McpServer(
    { name: '1c-form-viewer', version: '0.1.0' },
    {
      instructions: 'Read-only visual inspection of 1C Form.xml, Template.xml and MXL files. When the user provides a filesystem path, call open_preview with that path. If an internal browser is available, call get_preview_url after opening. Open a preview before using navigation tools.',
    },
  );

  server.registerTool('open_preview', {
    title: 'Open 1C preview',
    description: 'Open a Form.xml, Template.xml or MXL file in the shared Microsoft Edge preview window.',
    inputSchema: z.object({ path: z.string().min(1).describe('Absolute or relative path to Form.xml, Template.xml or MXL. The path must be below --root, unless the server was started with --allow-any-path.') }),
    annotations,
  }, guarded(async ({ path }) => visualResult(controller, await controller.open(path))));

  server.registerTool('get_preview_url', {
    title: 'Get internal preview URL',
    description: 'Return a loopback URL for opening the current preview in the MCP client\'s internal browser. The separate Microsoft Edge preview remains active.',
    inputSchema: z.object({}),
    annotations,
  }, guarded(async () => textResult(await controller.previewUrl())));

  server.registerTool('reload_preview', {
    title: 'Reload 1C preview',
    description: 'Read the active file again and preserve active pages when they still exist.',
    inputSchema: z.object({}),
    annotations,
  }, guarded(async () => visualResult(controller, await controller.reload())));

  server.registerTool('inspect_preview', {
    title: 'Inspect 1C preview',
    description: 'Return renderer element IDs, names, captions, types, visibility, nesting, tabs and scroll areas.',
    inputSchema: z.object({
      query: z.string().optional().describe('Case-insensitive filter over ID, name, caption and type.'),
      visible_only: z.boolean().optional().default(false),
    }),
    annotations,
  }, guarded(async ({ query, visible_only }) => visualResult(controller, await controller.inspect(query, visible_only))));

  server.registerTool('switch_tab', {
    title: 'Switch form page',
    description: 'Activate a regular or nested form page by stable model ID.',
    inputSchema: z.object({
      page_id: z.string().min(1),
      pages_id: z.string().min(1).optional().describe('Owner Pages ID, required only when page_id is ambiguous.'),
    }),
    annotations,
  }, guarded(async ({ page_id, pages_id }) => visualResult(controller, await controller.switchTab(page_id, pages_id))));

  server.registerTool('select_element', {
    title: 'Select form element',
    description: 'Reveal parent pages, highlight an element by model ID and scroll it into view.',
    inputSchema: z.object({ element_id: z.string().min(1) }),
    annotations,
  }, guarded(async ({ element_id }) => visualResult(controller, await controller.selectElement(element_id))));

  server.registerTool('scroll_preview', {
    title: 'Scroll 1C preview',
    description: 'Scroll the document, active page, table, or spreadsheet field using coordinates or deltas.',
    inputSchema: z.object({
      target: z.enum(['document', 'active-page', 'table', 'spreadsheet']),
      element_id: z.string().min(1).optional(),
      delta_x: z.number().optional(),
      delta_y: z.number().optional(),
      x: z.number().nonnegative().optional(),
      y: z.number().nonnegative().optional(),
    }),
    annotations,
  }, guarded(async (args) => {
    const payload = await controller.scroll({
      target: args.target,
      elementId: args.element_id,
      deltaX: args.delta_x,
      deltaY: args.delta_y,
      x: args.x,
      y: args.y,
    });
    return visualResult(controller, payload);
  }));

  server.registerTool('capture_preview', {
    title: 'Capture 1C preview',
    description: 'Capture the viewport, full browser document, or one visible preview element as PNG.',
    inputSchema: z.object({
      scope: z.enum(['viewport', 'document', 'element']).default('viewport'),
      element_id: z.string().min(1).optional(),
    }),
    annotations,
  }, guarded(async ({ scope, element_id }) => {
    const screenshot = await controller.capture(scope, element_id);
    const state = await controller.inspect(undefined, false).then((result) => result.state);
    return visualResult(controller, { scope, elementId: element_id || '', state }, screenshot);
  }));

  server.registerTool('close_preview', {
    title: 'Close 1C preview',
    description: 'Close the Edge session owned by this MCP process without changing any source file.',
    inputSchema: z.object({}),
    annotations,
  }, guarded(async () => textResult(await controller.close())));

  return server;
}
