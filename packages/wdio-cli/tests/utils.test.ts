import { vi, describe, it, expect, afterEach, beforeEach, test } from 'vitest'
import path from 'node:path'
import * as childProcess from 'node:child_process'
import fs from 'node:fs/promises'
import ejs from 'ejs'
import readDir from 'recursive-readdir'
import { SevereServiceError } from 'webdriverio'
import { ConfigParser } from '@wdio/config'

import {
    runLauncherHook,
    runOnCompleteHook,
    runServiceHook,
    getRunnerName,
    findInConfig,
    replaceConfig,
    addServiceDeps,
    convertPackageHashToObject,
    renderConfigurationFile,
    validateServiceAnswers,
    getCapabilities,
    hasFile,
    generateTestFiles,
    getPathForFileGeneration,
    getDefaultFiles,
    hasPackage,
    specifyVersionIfNeeded
} from '../src/utils.js'
import { COMPILER_OPTION_ANSWERS } from '../src/constants.js'

vi.mock('ejs')
vi.mock('recursive-readdir')
vi.mock('@wdio/logger', () => import(path.join(process.cwd(), '__mocks__', '@wdio/logger')))
vi.mock('child_process', function () {
    const m = {
        execSyncRes: 'APPIUM_MISSING',
        execSync: function () { return m.execSyncRes }
    }
    return m
})

vi.mock('../src/commands/config', () => ({
    runConfig: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
    default: {
        access: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn().mockReturnValue(Promise.resolve())
    }
}))

vi.mock('@wdio/config', () => ({
    ConfigParser: class ConfigParserMock {
        initialize () {}
        getCapabilities () {}
    }
}))

beforeEach(() => {
    global.console.log = vi.fn()
})

describe('runServiceHook', () => {
    const hookSuccess = vi.fn()
    const slowSetupFn = vi.fn()
    const asyncHookSuccess = vi.fn().mockImplementation(() => new Promise<void>(resolve => {
        setTimeout(() => {
            slowSetupFn()
            resolve()
        }, 20)
    }))

    beforeEach(() => {
        hookSuccess.mockClear()
        slowSetupFn.mockClear()
        asyncHookSuccess.mockClear()
    })

    it('run sync and async hooks successfully', async () => {
        await runServiceHook([
            { onPrepare: hookSuccess },
            { onPrepare: asyncHookSuccess },
            // @ts-ignore test invalid parameter
            { onPrepare: 'foobar' },
        ], 'onPrepare', 1, true, 'abc')
        expect(hookSuccess).toBeCalledTimes(1)
        expect(asyncHookSuccess).toBeCalledTimes(1)
        expect(slowSetupFn).toBeCalledTimes(1)
    })

    it('executes all hooks and continues after a hook throws error', async () => {
        const hookFailing = vi.fn().mockImplementation(() => { throw new Error('buhh') })

        await runServiceHook([
            { onPrepare: hookSuccess },
            // @ts-ignore test invalid parameter
            { onPrepare: 'foobar' },
            { onPrepare: asyncHookSuccess },
            { onPrepare: hookFailing },
        ], 'onPrepare', 1, true, 'abc')

        expect(hookSuccess).toBeCalledTimes(1)
        expect(hookFailing).toBeCalledTimes(1)
        expect(slowSetupFn).toBeCalledTimes(1)
        expect(asyncHookSuccess).toBeCalledTimes(1)
    })

    it('executes all hooks and stops after a hook throws SevereServiceError', async () => {
        const hookFailing = vi.fn().mockImplementation(() => { throw new SevereServiceError() })

        try {
            await runServiceHook([
                { onPrepare: hookSuccess },
                // @ts-ignore test invalid parameter
                { onPrepare: 'foobar' },
                { onPrepare: asyncHookSuccess },
                { onPrepare: hookFailing },
            ], 'onPrepare', 1, true, 'abc')
        } catch (err: any) {
            expect(err.message).toEqual(expect.stringContaining('SevereServiceError'))
            expect(err.message).toEqual(expect.stringContaining('Stopping runner...'))
            expect(hookSuccess).toBeCalledTimes(1)
            expect(hookFailing).toBeCalledTimes(1)
            expect(slowSetupFn).toBeCalledTimes(1)
            expect(asyncHookSuccess).toBeCalledTimes(1)
        }
    })
})

test('runLauncherHook handles array of functions', () => {
    const hookSuccess = vi.fn()
    const hookFailing = vi.fn().mockImplementation(() => { throw new Error('buhh') })

    runLauncherHook([hookSuccess, hookFailing], 1, 2, 3, 4, 5, 6)
    expect(hookSuccess).toBeCalledTimes(1)
    expect(hookSuccess).toHaveBeenCalledWith(1, 2, 3, 4, 5, 6)
    expect(hookFailing).toBeCalledTimes(1)
    expect(hookFailing).toHaveBeenCalledWith(1, 2, 3, 4, 5, 6)
})

test('runLauncherHook handles async functions', async () => {
    const hookSuccess = () => new Promise(resolve => setTimeout(resolve, 31))

    const start = Date.now()
    await runLauncherHook([hookSuccess], {}, {})
    expect(Date.now() - start).toBeGreaterThanOrEqual(30)
})

test('runLauncherHook handles a single function', () => {
    const hookSuccess = vi.fn()

    runLauncherHook(hookSuccess, 1, 2, 3, 4, 5, 6)
    expect(hookSuccess).toBeCalledTimes(1)
    expect(hookSuccess).toHaveBeenCalledWith(1, 2, 3, 4, 5, 6)
})

test('runOnCompleteHook handles array of functions', () => {
    const hookSuccess = vi.fn()
    const secondHook = vi.fn()

    runOnCompleteHook([hookSuccess, secondHook], { capabilities: {} }, {}, 0, {} as any)
    expect(hookSuccess).toBeCalledTimes(1)
    expect(secondHook).toBeCalledTimes(1)
})

test('runOnCompleteHook handles async functions', async () => {
    const hookSuccess = () => new Promise(resolve => setTimeout(resolve, 31))

    const start = Date.now()
    await runOnCompleteHook([hookSuccess], { capabilities: {} }, {}, 0, {} as any)
    expect(Date.now() - start).toBeGreaterThanOrEqual(30)
})

test('runOnCompleteHook handles a single function', () => {
    const hookSuccess = vi.fn()

    runOnCompleteHook(hookSuccess, { capabilities: {} }, {}, 0, {} as any)
    expect(hookSuccess).toBeCalledTimes(1)
})

test('runOnCompleteHook with no failure returns 0', async () => {
    const hookSuccess = vi.fn()
    const hookFailing = vi.fn()

    const result = await runOnCompleteHook([hookSuccess, hookFailing], { capabilities: {} }, {}, 0, {} as any)

    expect(result).not.toContain(1)
    expect(hookSuccess).toBeCalledTimes(1)
    expect(hookFailing).toBeCalledTimes(1)
})

test('runOnCompleteHook with failure returns 1', async () => {
    const hookSuccess = vi.fn()
    const hookFailing = vi.fn().mockImplementation(() => { throw new Error('buhh') })

    const result = await runOnCompleteHook([hookSuccess, hookFailing], { capabilities: {} }, {}, 0, {} as any)

    expect(result).toContain(1)
    expect(hookSuccess).toBeCalledTimes(1)
    expect(hookFailing).toBeCalledTimes(1)
})

test('runOnCompleteHook fails with SevereServiceError', async () => {
    const hookSuccess = vi.fn()
    const hookFailing = vi.fn().mockImplementation(() => { throw new SevereServiceError('buhh') })

    const result = await runOnCompleteHook([hookSuccess, hookFailing], { capabilities: {} }, {}, 0, {} as any)
        .catch(() => 'some error')

    expect(result).toBe('some error')
    expect(hookSuccess).toBeCalledTimes(1)
    expect(hookFailing).toBeCalledTimes(1)
})

test('getRunnerName', () => {
    expect(getRunnerName({ 'appium:appPackage': 'foobar' })).toBe('foobar')
    expect(getRunnerName({ 'appium:appWaitActivity': 'foobar' })).toBe('foobar')
    expect(getRunnerName({ 'appium:app': 'foobar' })).toBe('foobar')
    expect(getRunnerName({ 'appium:platformName': 'foobar' })).toBe('foobar')
    expect(getRunnerName({ browserName: 'foobar' })).toBe('foobar')
    expect(getRunnerName({ appPackage: 'foobar' })).toBe('foobar')
    expect(getRunnerName({ appWaitActivity: 'foobar' })).toBe('foobar')
    expect(getRunnerName({ app: 'foobar' })).toBe('foobar')
    expect(getRunnerName({ platformName: 'foobar' })).toBe('foobar')
    expect(getRunnerName({})).toBe('undefined')
    expect(getRunnerName()).toBe('undefined')
    // @ts-ignore test invalid parameter
    expect(getRunnerName({ foo: {} })).toBe('undefined')
    // @ts-ignore test invalid parameter
    expect(getRunnerName({ foo: { capabilities: {} }, bar: {} })).toBe('undefined')
    // @ts-ignore test invalid parameter
    expect(getRunnerName({ foo: { capabilities: {} } })).toBe('MultiRemote')
})

describe('findInConfig', () => {
    it('finds text for services', () => {
        const str = "services: ['foo', 'bar'],"

        expect(findInConfig(str, 'service')).toMatchObject([
            'services: [\'foo\', \'bar\']'
        ])
    })

    it('finds text for frameworks', () => {
        const str = "framework: 'mocha'"

        expect(findInConfig(str, 'framework')).toMatchObject([
            "framework: 'mocha'"
        ])
    })
})

describe('renderConfigurationFile', () => {
    it('should write file', async () => {
        vi.mocked(ejs.renderFile).mockImplementation((a, b, c: any) => c(null, true))

        await renderConfigurationFile({ foo: 'bar' } as any)

        expect(ejs.renderFile).toHaveBeenCalled()
        expect(fs.writeFile).toHaveBeenCalled()
        expect((vi.mocked(fs.writeFile).mock.calls[0][0] as string)
            .endsWith('wdio.conf.js')).toBe(true)
    })

    it('should write TS file', async () => {
        // @ts-ignore mock feature
        vi.mocked(ejs.renderFile).mockImplementation((a, b, c) => c(null, true))

        await renderConfigurationFile({ isUsingTypeScript: true } as any)

        expect(ejs.renderFile).toHaveBeenCalled()
        expect(fs.writeFile).toHaveBeenCalled()
        expect((vi.mocked(fs.writeFile).mock.calls[0][0] as string)
            .endsWith('wdio.conf.ts')).toBe(true)
    })

    it('should throw error', async () => {
        // @ts-ignore mock feature
        vi.mocked(ejs.renderFile).mockImplementationOnce((a, b, c) => c('test error', null))

        try {
            await renderConfigurationFile({ foo: 'bar' } as any)
        } catch (error) {
            expect(error).toBeTruthy()
        }
    })
})

describe('replaceConfig', () => {
    it('correctly changes framework', () => {
        const fakeConfig = `exports.config = {
    runner: 'local',
    specs: [
        './test/specs/**/*.js'
    ],
    framework: 'mocha',
}`

        expect(replaceConfig(fakeConfig, 'framework', 'jasmine')).toBe(
            `exports.config = {
    runner: 'local',
    specs: [
        './test/specs/**/*.js'
    ],
    framework: 'jasmine',
}`
        )
    })

    it('correctly changes service', () => {
        const fakeConfig = `exports.config = {
    runner: 'local',
    specs: [
        './test/specs/**/*.js'
    ],
    services: ['chromedriver'],
    framework: 'mocha',
}`
        expect(replaceConfig(fakeConfig, 'service', 'sauce')).toBe(
            `exports.config = {
    runner: 'local',
    specs: [
        './test/specs/**/*.js'
    ],
    services: ['chromedriver','sauce'],
    framework: 'mocha',
}`
        )
    })
})

describe('addServiceDeps', () => {
    it('should add appium', () => {
        const packages: any = []
        addServiceDeps([{ package: '@wdio/appium-service', short: 'appium' }], packages)
        expect(packages).toEqual(['appium'])
        expect(global.console.log).not.toBeCalled()
    })

    it('should not add appium if globally installed', () => {
        // @ts-ignore
        // eslint-disable-next-line no-import-assign, @typescript-eslint/no-unused-vars
        childProcess.execSyncRes = '1.13.0'
        const packages: any = []
        addServiceDeps([{ package: '@wdio/appium-service', short: 'appium' }], packages)
        expect(packages).toEqual([])
        expect(global.console.log).not.toBeCalled()
    })

    it('should add appium and print message if update and appium globally installed', () => {
        const packages: any = []
        addServiceDeps([{ package: '@wdio/appium-service', short: 'appium' }], packages, true)
        expect(packages).toEqual([])
        expect(global.console.log).toBeCalled()
    })

    it('should add chromedriver', () => {
        const packages: any = []
        addServiceDeps([{ package: 'wdio-chromedriver-service', short: 'chromedriver' }], packages)
        expect(packages).toEqual(['chromedriver'])
        expect(global.console.log).not.toBeCalled()
    })

    it('should add chromedriver and print message if update', () => {
        const packages: any = []
        addServiceDeps([{ package: 'wdio-chromedriver-service', short: 'chromedriver' }], packages, true)
        expect(packages).toEqual(['chromedriver'])
        expect(global.console.log).toBeCalled()
    })

    afterEach(() => {
        vi.mocked(global.console.log).mockClear()
    })
})

describe('convertPackageHashToObject', () => {
    it('works with default `$--$` hash', () => {
        expect(convertPackageHashToObject('test/package-name$--$package-name')).toMatchObject({
            package: 'test/package-name',
            short: 'package-name'
        })
    })

    it('works with custom hash', () => {
        expect(convertPackageHashToObject('test/package-name##-##package-name', '##-##')).toMatchObject({
            package: 'test/package-name',
            short: 'package-name'
        })
    })
})

test('validateServiceAnswers', () => {
    expect(validateServiceAnswers(['wdio-chromedriver-service', '@wdio/selenium-standalone-service']))
        .toContain('wdio-chromedriver-service cannot work together with @wdio/selenium-standalone-service')
    expect(validateServiceAnswers(['@wdio/static-server-service', '@wdio/selenium-standalone-service']))
        .toBe(true)
})

describe('getCapabilities', () => {
    it('should return driver with capabilities for android', async () => {
        expect(await getCapabilities({ option: 'foo.apk' } as any)).toMatchSnapshot()
        expect(await getCapabilities({ option: 'android' } as any)).toMatchSnapshot()
    })

    it('should return driver with capabilities for ios', async () => {
        expect(await getCapabilities({ option: 'foo.app', deviceName: 'fooName', udid: 'num', platformVersion: 'fooNum' } as any))
            .toMatchSnapshot()
        expect(await getCapabilities({ option: 'ios' } as any)).toMatchSnapshot()
    })

    it('should return driver with capabilities for desktop', async () => {
        expect(await getCapabilities({ option: 'chrome' } as any)).toMatchSnapshot()
    })

    it('should throw config not found error', async () => {
        const initializeMock = vi.spyOn(ConfigParser.prototype, 'initialize')
        initializeMock.mockImplementationOnce(() => {
            const error: any = new Error('ups')
            error.code = 'MODULE_NOT_FOUND'
            return Promise.reject(error)
        })
        await expect(() => getCapabilities({ option: './test.js', capabilities: 2 } as any))
            .rejects.toThrowErrorMatchingSnapshot()
        initializeMock.mockImplementationOnce(async () => { throw new Error('ups') })
        await expect(() => getCapabilities({ option: './test.js', capabilities: 2 } as any))
            .rejects.toThrowErrorMatchingSnapshot()
    })

    it('should throw capability not provided', async () => {
        await expect(() => getCapabilities({ option: '/path/to/config.js' } as any))
            .rejects.toThrowErrorMatchingSnapshot()
    })

    it('should through capability not found', async () => {
        const cap = { browserName: 'chrome' }
        const getCapabilitiesMock = vi.spyOn(ConfigParser.prototype, 'getCapabilities')
        getCapabilitiesMock.mockReturnValue([cap, cap, cap, cap, cap])
        await expect(() => getCapabilities({ option: '/path/to/config.js', capabilities: 5 } as any))
            .rejects.toThrowErrorMatchingSnapshot()
    })

    it('should get capability from wdio.conf.js', async () => {
        const autoCompileMock = vi.spyOn(ConfigParser.prototype, 'initialize')
        const getCapabilitiesMock = vi.spyOn(ConfigParser.prototype, 'getCapabilities')
        getCapabilitiesMock.mockReturnValue([
            { browserName: 'chrome' },
            {
                browserName: 'firefox',
                specs: ['/path/to/some/specs.js']
            },
            {
                maxInstances: 5,
                browserName: 'chrome',
                acceptInsecureCerts: true,
                'goog:chromeOptions' : { 'args' : ['window-size=8000,1200'] }
            }
        ])
        expect(await getCapabilities({ option: '/path/to/config.js', capabilities: 2 } as any))
            .toMatchSnapshot()
        expect(autoCompileMock).toBeCalledTimes(1)
    })
})

test('hasFile', () => {
    vi.mocked(fs.access).mockResolvedValue()
    expect(hasFile('package.json')).toBe(true)
    vi.mocked(fs.access).mockRejectedValue(new Error('not existing'))
    expect(hasFile('xyz')).toBe(false)
})

test('hasPackage', () => {
    expect(hasPackage('yargs')).toBe(true)
    expect(hasPackage('foobar')).toBe(false)
})

describe('generateTestFiles', () => {
    it('Mocha with page objects', async () => {
        vi.mocked(readDir).mockResolvedValue([
            '/foo/bar/loo/page.js.ejs',
            '/foo/bar/example.e2e.js'
        ] as any)
        const answers = {
            framework: 'mocha',
            usePageObjects: true,
            generateTestFiles: true,
            destPageObjectRootPath: '/tests/page/objects/model',
            destSpecRootPath: '/tests/specs'
        }

        await generateTestFiles(answers as any)

        expect(readDir).toBeCalledTimes(2)
        expect(vi.mocked(readDir).mock.calls[0][0]).toContain('mocha')
        expect(vi.mocked(readDir).mock.calls[1][0]).toContain('pageobjects')

        /**
         * test readDir callback
         */
        const readDirCb = vi.mocked(readDir).mock.calls[0][1][0] as Function
        const stats = { isDirectory: vi.fn().mockReturnValue(false) }
        expect(readDirCb('/foo/bar.lala', stats)).toBe(true)
        expect(readDirCb('/foo/bar.js.ejs', stats)).toBe(false)
        expect(readDirCb('/foo/bar.feature', stats)).toBe(false)
        stats.isDirectory.mockReturnValue(true)
        expect(readDirCb('/foo/bar.lala', stats)).toBe(false)
        expect(readDirCb('/foo/bar.js.ejs', stats)).toBe(false)
        expect(readDirCb('/foo/bar.feature', stats)).toBe(false)

        expect(ejs.renderFile).toBeCalledTimes(4)
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/loo/page.js.ejs',
            answers,
            expect.any(Function)
        )
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/example.e2e.js',
            answers,
            expect.any(Function)
        )
        expect(fs.mkdir).toBeCalledTimes(4)
        expect((vi.mocked(fs.writeFile).mock.calls[0][0] as string).endsWith('/page/objects/model/page.js'))
            .toBe(true)
        expect((vi.mocked(fs.writeFile).mock.calls[1][0] as string).endsWith('/example.e2e.js'))
            .toBe(true)
    })

    it('jasmine with page objects', async () => {
        vi.mocked(readDir).mockResolvedValue([
            '/foo/bar/loo/page.js.ejs',
            '/foo/bar/example.e2e.js'
        ] as any)
        const answers = {
            framework: 'jasmine',
            usePageObjects: true,
            generateTestFiles: true,
            destPageObjectRootPath: '/tests/page/objects/model',
            destSpecRootPath: '/tests/specs'
        }

        await generateTestFiles(answers as any)

        expect(readDir).toBeCalledTimes(2)
        expect(vi.mocked(readDir).mock.calls[0][0]).toContain('jasmine')
        expect(vi.mocked(readDir).mock.calls[1][0]).toContain('pageobjects')

        /**
         * test readDir callback
         */
        const readDirCb = vi.mocked(readDir).mock.calls[0][1][0] as Function
        const stats = { isDirectory: vi.fn().mockReturnValue(false) }
        expect(readDirCb('/foo/bar.lala', stats)).toBe(true)
        expect(readDirCb('/foo/bar.js.ejs', stats)).toBe(false)
        expect(readDirCb('/foo/bar.feature', stats)).toBe(false)
        stats.isDirectory.mockReturnValue(true)
        expect(readDirCb('/foo/bar.lala', stats)).toBe(false)
        expect(readDirCb('/foo/bar.js.ejs', stats)).toBe(false)
        expect(readDirCb('/foo/bar.feature', stats)).toBe(false)

        expect(ejs.renderFile).toBeCalledTimes(4)
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/loo/page.js.ejs',
            answers,
            expect.any(Function)
        )
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/example.e2e.js',
            answers,
            expect.any(Function)
        )
        expect(fs.mkdir).toBeCalledTimes(4)
        expect((vi.mocked(fs.writeFile).mock.calls[0][0] as string)
            .endsWith('/page/objects/model/page.js'))
            .toBe(true)
        expect((vi.mocked(fs.writeFile).mock.calls[1][0] as string)
            .endsWith('/example.e2e.js'))
            .toBe(true)
    })

    it('Jasmine with page generation and no pageObjects', async () => {
        vi.mocked(readDir).mockResolvedValue([] as any)
        const answers = {
            specs: './tests/e2e/**/*.js',
            framework: 'jasmine',
            generateTestFiles: false,
            usePageObjects: false
        }

        await generateTestFiles(answers as any)

        expect(readDir).toBeCalledTimes(1)
        expect(ejs.renderFile).toBeCalledTimes(0)
    })

    it('Cucumber with page generation and no pageObjects', async () => {
        vi.mocked(readDir).mockResolvedValue([] as any)
        const answers = {
            specs: './tests/e2e/**/*.js',
            framework: 'cucumber',
            generateTestFiles: false,
            usePageObjects: false,
        }

        await generateTestFiles(answers as any)

        expect(readDir).toBeCalledTimes(1)
        expect(ejs.renderFile).toBeCalledTimes(0)
    })

    it('Cucumber without page objects', async () => {
        vi.mocked(readDir).mockResolvedValue([
            '/foo/bar/loo/step_definition/example.step.js',
            '/foo/bar/example.feature'
        ] as any)
        const answers = {
            specs: './tests/e2e/*.js',
            framework: 'cucumber',
            stepDefinitions: '/some/step/defs',
            usePageObjects: false,
            generateTestFiles: true
        }
        await generateTestFiles(answers as any)

        expect(readDir).toBeCalledTimes(1)
        expect(vi.mocked(readDir).mock.calls[0][0]).toContain('cucumber')
        expect(ejs.renderFile).toBeCalledTimes(2)
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/loo/step_definition/example.step.js',
            answers,
            expect.any(Function)
        )
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/example.feature',
            answers,
            expect.any(Function)
        )
        expect(fs.mkdir).toBeCalledTimes(2)
    })

    it('Cucumber with page objects and TypeScript', async () => {
        vi.mocked(readDir).mockResolvedValue([
            '/foo/bar/loo/page.js.ejs',
            '/foo/bar/loo/step_definition/example.step.js',
            '/foo/bar/example.feature'
        ] as any)
        const answers = {
            framework: 'cucumber',
            usePageObjects: true,
            isUsingTypeScript: true,
            stepDefinitions: '/some/step',
            destPageObjectRootPath: '/some/page/objects',
            relativePath: '../page/object'
        }
        await generateTestFiles(answers as any)

        expect(readDir).toBeCalledTimes(2)
        expect(vi.mocked(readDir).mock.calls[0][0]).toContain('cucumber')
        expect(ejs.renderFile).toBeCalledTimes(6)
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/loo/step_definition/example.step.js',
            answers,
            expect.any(Function)
        )
        expect(ejs.renderFile).toBeCalledWith(
            '/foo/bar/example.feature',
            answers,
            expect.any(Function)
        )
        expect(fs.mkdir).toBeCalledTimes(6)
        expect((vi.mocked(fs.writeFile).mock.calls[0][0] as string).endsWith('/some/page/objects/page.ts'))
            .toBe(true)
        expect((vi.mocked(fs.writeFile).mock.calls[2][0] as string).endsWith('/example.feature'))
            .toBe(true)
    })
})

describe('getPathForFileGeneration', () => {
    it('Cucumber with pageobjects default values', () => {
        const generatedPaths = getPathForFileGeneration({
            stepDefinitions: './features/step-definitions/steps.js',
            pages: './features/pageobjects/**/*.js',
            generateTestFiles: true,
            usePageObjects: true,
            framework: '@wdio/cucumber-service$--$cucumber'
        } as any)
        expect(generatedPaths.relativePath).toEqual('../pageobjects')
    })

    it('Cucumber with pageobjects default different path', () => {
        const generatedPaths = getPathForFileGeneration({
            stepDefinitions: './features/step-definitions/steps.js',
            pages: './features/page/objects/**/*.js',
            generateTestFiles: true,
            usePageObjects: true,
            framework: '@wdio/cucumber-service$--$cucumber'
        } as any)
        expect(generatedPaths.relativePath).toEqual('../page/objects')
    })

    it('Mocha with pageobjects default values', () => {
        const generatedPaths = getPathForFileGeneration({
            specs: './test/specs/**/*.js',
            pages: './test/pageobjects/**/*.js',
            generateTestFiles: true,
            usePageObjects: true,
            framework: '@wdio/cucumber-service$--$mocha'
        } as any)
        expect(generatedPaths.relativePath).toEqual('../pageobjects')
    })

    it('Mocha with pageobjects different path', () => {
        const generatedPaths = getPathForFileGeneration({
            specs: './test/specs/files/**/*.js',
            pages: './test/pageobjects/**/*.js',
            generateTestFiles: true,
            usePageObjects: true,
            framework: '@wdio/cucumber-service$--$mocha'
        } as any)
        expect(generatedPaths.relativePath).toEqual('../../pageobjects')
    })

    it('Do not auto generate file', () => {
        const generatedPaths = getPathForFileGeneration({
            specs: './test/specs/files/**/*.js',
            pages: './test/pageobjects/**/*.js',
            generateTestFiles: false,
            usePageObjects: true,
            framework: '@wdio/cucumber-service$--$mocha'
        } as any)
        expect(generatedPaths.relativePath).toEqual('')
    })

    it('Do not use PageObjects', () => {
        const generatedPaths = getPathForFileGeneration({
            specs: './test/specs/files/**/*.js',
            pages: './test/pageobjects/**/*.js',
            generateTestFiles: true,
            usePageObjects: false,
            framework: '@wdio/cucumber-service$--$mocha'
        } as any)
        expect(generatedPaths.relativePath).toEqual('')
    })
})

test('getDefaultFiles', () => {
    const files = '/foo/bar'
    expect(getDefaultFiles({ isUsingCompiler: COMPILER_OPTION_ANSWERS[0] }, files))
        .toBe('/foo/bar.js')
    expect(getDefaultFiles({ isUsingCompiler: COMPILER_OPTION_ANSWERS[1] }, files))
        .toBe('/foo/bar.ts')
    expect(getDefaultFiles({ isUsingCompiler: COMPILER_OPTION_ANSWERS[2] }, files))
        .toBe('/foo/bar.js')
})

test('specifyVersionIfNeeded', () => {
    expect(specifyVersionIfNeeded(
        ['webdriverio', '@wdio/spec-reporter', 'wdio-chromedriver-service', 'wdio-geckodriver-service'],
        '8.0.0-alpha.249+4bc237701'
    )).toEqual([
        'webdriverio@^8.0.0-alpha.249',
        '@wdio/spec-reporter@^8.0.0-alpha.249',
        'wdio-chromedriver-service@next',
        'wdio-geckodriver-service'
    ])
})

afterEach(() => {
    vi.mocked(console.log).mockRestore()
    vi.mocked(readDir).mockClear()
    vi.mocked(fs.writeFile).mockClear()
    vi.mocked(fs.mkdir).mockClear()
    vi.mocked(ejs.renderFile).mockClear()
})
