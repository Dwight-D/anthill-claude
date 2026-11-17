import type { Register } from 'claude-code'

const pad = (n: number) => String(n).padStart(2, '0')

const format = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Messages carry no timestamp of their own; the first time a message row is
// drawn is recorded under its id in the cross-session store.
export const timestamps: Register = on => {
  on('ui.render', { component: ['UserMessage', 'AssistantMessage'] }, async ($, e, next) => {
    if (e.component === 'AssistantMessage' && !(e.props as { isFirstOfReply?: boolean }).isFirstOfReply) {
      return next(e)
    }

    const key = `ts:${e.requestId}`
    let at = Number(await $.store.get(key))
    if (!at) {
      at = await $.clock.now()
      await $.store.set(key, at)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text dimColor>{format(at)}</Text>
        {await next(e)}
      </Box>
    )
  })
}
