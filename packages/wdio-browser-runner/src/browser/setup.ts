import { automationProtocolPath } from 'virtual:wdio'
import { expect } from 'expect-webdriverio'
import { remote } from 'webdriverio'
import { _setGlobal } from '@wdio/globals'

type WDIOErrorEvent = Pick<ErrorEvent, 'filename' | 'message'>

declare global {
    interface Window {
        __wdioErrors__: WDIOErrorEvent[]
    }
}

window.__wdioErrors__ = []
addEventListener('error', (ev) => window.__wdioErrors__.push({
    filename: ev.filename,
    message: ev.message
}))

export async function setupEnv () {
    const injectGlobals = window.__wdioEnv__.injectGlobals
    const browser = await remote({
        automationProtocol: automationProtocolPath as any,
        capabilities: window.__wdioEnv__.capabilities
    })
    _setGlobal('browser', browser, injectGlobals)
    _setGlobal('driver', browser, injectGlobals)
    _setGlobal('expect', expect, injectGlobals)
    _setGlobal('$', browser.$.bind(browser), injectGlobals)
    _setGlobal('$$', browser.$.bind(browser), injectGlobals)
}
