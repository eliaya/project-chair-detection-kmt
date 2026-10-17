export default {
  async fetch() {
    return Response.json({ title: 'Unauthorized' }, { status: 401 })
  },
} satisfies ExportedHandler<Env>
