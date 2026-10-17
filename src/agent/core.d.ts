export declare function countVisitor(request: Request, env: unknown, ctx: ExecutionContext, ip: string): Promise<void> | undefined;
export declare function pruneVisitors(env: unknown): Promise<void>;
export declare function clientIp(request: Request): string;
