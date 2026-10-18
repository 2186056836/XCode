import { z } from "zod";

export const zcodeProtocolTraceSchema = z
  .object({
    traceId: z.string().min(1).optional(),
    parentId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional(),
    traceparent: z.string().min(1).optional(),
  })
  .strict();
export type XCodeProtocolTrace = z.infer<typeof zcodeProtocolTraceSchema>;
