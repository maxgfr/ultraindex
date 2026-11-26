const handler = (req: Request) => new Response(req.url);

export { handler as GET, handler as POST };
