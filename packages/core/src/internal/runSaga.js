import * as is from '@redux-saga/is'
import { compose } from 'redux'
import proc from './proc'
import { stdChannel } from './channel'
import { immediately } from './scheduler'
import nextSagaId from './uid'
import { check, logError, noop, wrapSagaDispatch, identity, getMetaInfo } from './utils'

const RUN_SAGA_SIGNATURE = 'runSaga(options, saga, ...args)'
const NON_GENERATOR_ERR = `${RUN_SAGA_SIGNATURE}: saga argument must be a Generator function!`

export function runSaga(
  { channel = stdChannel(), dispatch, getState, context = {}, sagaMonitor, effectMiddlewares, onError = logError },
  saga,   // 传入的 rootSaga，是一个 generator，返回一个iterator
  ...args
) {
  if (process.env.NODE_ENV !== 'production') {
    check(saga, is.func, NON_GENERATOR_ERR)
  }

  const iterator = saga(...args) // 从这里可以发现，runSaga的时候可以传入更多参数，然后在saga函数中可以获取

  if (process.env.NODE_ENV !== 'production') {
    check(iterator, is.iterator, NON_GENERATOR_ERR)
  }

  const effectId = nextSagaId() // nextSagaId = () => ++current

  if (sagaMonitor) {
    // monitors are expected to have a certain interface, let's fill-in any missing ones
    sagaMonitor.rootSagaStarted = sagaMonitor.rootSagaStarted || noop
    sagaMonitor.effectTriggered = sagaMonitor.effectTriggered || noop
    sagaMonitor.effectResolved = sagaMonitor.effectResolved || noop
    sagaMonitor.effectRejected = sagaMonitor.effectRejected || noop
    sagaMonitor.effectCancelled = sagaMonitor.effectCancelled || noop
    sagaMonitor.actionDispatched = sagaMonitor.actionDispatched || noop

    sagaMonitor.rootSagaStarted({ effectId, saga, args })
  }

  if (process.env.NODE_ENV !== 'production') {
    if (is.notUndef(dispatch)) {
      check(dispatch, is.func, 'dispatch must be a function')
    }

    if (is.notUndef(getState)) {
      check(getState, is.func, 'getState must be a function')
    }

    if (is.notUndef(effectMiddlewares)) {
      const MIDDLEWARE_TYPE_ERROR = 'effectMiddlewares must be an array of functions'
      check(effectMiddlewares, is.array, MIDDLEWARE_TYPE_ERROR)
      effectMiddlewares.forEach(effectMiddleware => check(effectMiddleware, is.func, MIDDLEWARE_TYPE_ERROR))
    }

    check(onError, is.func, 'onError passed to the redux-saga is not a function!')
  }

  let finalizeRunEffect
  if (effectMiddlewares) {
    const middleware = compose(...effectMiddlewares)
    finalizeRunEffect = runEffect => {
      return (effect, effectId, currCb) => {
        const plainRunEffect = eff => runEffect(eff, effectId, currCb)
        return middleware(plainRunEffect)(effect)
      }
    }
  } else {
    finalizeRunEffect = identity // v => v
  }

  const env = {
    channel,
    dispatch: wrapSagaDispatch(dispatch), // action => dispatch(Object.defineProperty(action, SAGA_ACTION, { value: true }))
    getState,
    sagaMonitor,
    onError,
    finalizeRunEffect,
  }

  // return  task
  return immediately(() => {
    // getMetaInfo(saga) = { name: saga.name || 'anonymous', location: saga[SAGA_LOCATION] }
    const task = proc(env, iterator, context, effectId, getMetaInfo(saga), /* isRoot */ true, undefined)

    if (sagaMonitor) {
      sagaMonitor.effectResolved(effectId, task)
    }

    return task
  })
}
