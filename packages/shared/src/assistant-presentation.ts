import {
  getLatestAssistantContentPart,
  type XCodeAssistantMessagePart,
} from "./assistant-message-parts.js";

export interface XCodeAssistantPresentationToolCall {
  toolId: string;
  parentToolUseId?: string | null;
  kind: string;
  title?: string;
  input: unknown;
  status: string;
  output?: unknown;
  error?: string;
  raw?: unknown;
}

export type XCodeAssistantPresentationBlock =
  | {
      type: "content";
      content: string;
    }
  | {
      type: "thought";
      content: string;
    }
  | {
      type: "tool-call";
      toolCall: XCodeAssistantPresentationToolCall;
    };

export interface XCodeAssistantPresentation {
  messageParts: XCodeAssistantMessagePart[];
  blocks: XCodeAssistantPresentationBlock[];
  latestPart: Extract<XCodeAssistantPresentationBlock, { type: "content" }> | null;
  historyBlocks: XCodeAssistantPresentationBlock[];
}

export interface BuildXCodeAssistantPresentationOptions {
  content: string;
  thought?: string;
  toolCalls?: readonly XCodeAssistantPresentationToolCall[];
  parts?: readonly XCodeAssistantMessagePart[];
  streaming?: boolean;
  interrupted?: boolean;
  settling?: boolean;
}

function buildFallbackAssistantParts({
  content,
  thought,
  toolCalls,
}: Pick<BuildXCodeAssistantPresentationOptions, "content" | "thought" | "toolCalls">) {
  const rootToolCalls = (toolCalls ?? []).filter((toolCall) => {
    const parentToolUseId = toolCall.parentToolUseId ?? null;
    return (
      !parentToolUseId ||
      parentToolUseId === toolCall.toolId ||
      !(toolCalls ?? []).some((candidate) => candidate.toolId === parentToolUseId)
    );
  });

  return [
    ...(thought ? [{ type: "thought", content: thought } as const] : []),
    ...rootToolCalls.map(
      (toolCall) =>
        ({
          type: "tool-call",
          toolId: toolCall.toolId,
        }) as const,
    ),
    ...(content ? [{ type: "content", content } as const] : []),
  ];
}

export function buildXCodeAssistantPresentation({
  content,
  thought,
  toolCalls = [],
  parts,
  streaming = false,
  interrupted = false,
  settling = false,
}: BuildXCodeAssistantPresentationOptions): XCodeAssistantPresentation {
  const messageParts =
    parts && parts.length > 0
      ? [...parts]
      : buildFallbackAssistantParts({ content, thought, toolCalls });
  const toolCallById = new Map(toolCalls.map((toolCall) => [toolCall.toolId, toolCall]));
  const renderedToolCallIds = new Set<string>();
  const blocks: XCodeAssistantPresentationBlock[] = [];

  for (const part of messageParts) {
    if (part.type === "content") {
      blocks.push({ type: "content", content: part.content });
      continue;
    }
    if (part.type === "thought") {
      blocks.push({ type: "thought", content: part.content });
      continue;
    }

    const toolCall = toolCallById.get(part.toolId);
    if (!toolCall || renderedToolCallIds.has(part.toolId)) {
      continue;
    }
    const parentToolUseId = toolCall.parentToolUseId ?? null;
    if (
      parentToolUseId &&
      parentToolUseId !== toolCall.toolId &&
      toolCallById.has(parentToolUseId)
    ) {
      continue;
    }
    renderedToolCallIds.add(part.toolId);
    blocks.push({ type: "tool-call", toolCall });
  }

  const latestContentPart =
    streaming || interrupted || settling
      ? null
      : getLatestAssistantContentPart(
          blocks
            .filter(
              (block): block is Extract<XCodeAssistantPresentationBlock, { type: "content" }> =>
                block.type === "content",
            )
            .map((block) => ({ type: "content", content: block.content })),
        );
  let latestPart: Extract<XCodeAssistantPresentationBlock, { type: "content" }> | null = null;
  let latestBlockIndex = -1;
  if (latestContentPart) {
    latestBlockIndex = blocks.findLastIndex(
      (block) => block.type === "content" && block.content === latestContentPart.content,
    );
    latestPart =
      latestBlockIndex >= 0
        ? (blocks[latestBlockIndex] as Extract<
            XCodeAssistantPresentationBlock,
            { type: "content" }
          >)
        : null;
  }

  return {
    messageParts,
    blocks,
    latestPart,
    historyBlocks: blocks.filter((_, index) => index !== latestBlockIndex),
  };
}
