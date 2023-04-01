import { MitosisComponent } from '../../../types/mitosis-component';
import traverse from 'traverse';
import { File } from '../src-generator';
import { convertMethodToFunction } from './convert-method-to-function';
import { stableInject } from './stable-inject';
import { convertTypeScriptToJS } from '../../../helpers/babel-transform';

/**
 * Stores getters and initialization map.
 */
export type StateInit = [
  StateValues,
  /**
   * Set of state initializers.
   */
  ...string[],
];

export type PropertyName = string;
export type StateValue = string;

/**
 * Map of getters that need to be rewritten to function invocations.
 */
export type StateValues = Record<PropertyName, StateValue>;

/**
 * @param file
 * @param stateInit
 */
export function emitUseStore(file: File, stateInit: StateInit) {
  const state = stateInit[0];
  const hasState = state && Object.keys(state).length > 0;
  if (hasState) {
    file.src.emit('const state=', file.import(file.qwikModule, 'useStore').localName);
    if (file.options.isTypeScript) {
      file.src.emit('<any>');
    }
    file.src.emit(`(${stableInject(state)});`);
  } else {
    // TODO hack for now so that `state` variable is defined, even though it is never read.
    file.src.emit(`const state${file.options.isTypeScript ? ': any' : ''} = {};`);
  }
}

function emitStateMethods(
  file: File,
  componentState: MitosisComponent['state'],
  lexicalArgs: string[],
): StateInit {
  const stateValues: StateValues = {};
  const stateInit: StateInit = [stateValues];
  const methodMap = getStateMethodsAndGetters(componentState);
  for (const key in componentState) {
    const stateValue = componentState[key];

    switch (stateValue?.type) {
      case 'method':
      case 'getter':
      case 'function':
        let code = stateValue.code;
        let prefixIdx = 0;
        if (stateValue.type === 'getter') {
          prefixIdx += 'get '.length;
        } else if (stateValue.type === 'function') {
          prefixIdx += 'function '.length;
        }
        code = code.substring(prefixIdx);
        code = convertMethodToFunction(code, methodMap, lexicalArgs).replace(
          '(',
          `(${lexicalArgs.join(',')},`,
        );
        const functionName = code.split(/\(/)[0];
        if (stateValue.type === 'getter') {
          stateInit.push(`state.${key}=${functionName}(${lexicalArgs.join(',')})`);
        }
        if (!file.options.isTypeScript) {
          // Erase type information
          code = convertTypeScriptToJS(code);
        }
        file.exportConst(functionName, 'function ' + code, true);
        continue;

      case 'property':
        stateValues[key] = stateValue.code;
        continue;
    }
  }

  return stateInit;
}

export function emitStateMethodsAndRewriteBindings(
  file: File,
  component: MitosisComponent,
  metadata: Record<string, any>,
): StateInit {
  const lexicalArgs = getLexicalScopeVars(component);
  const state: StateInit = emitStateMethods(file, component.state, lexicalArgs);
  const methodMap = getStateMethodsAndGetters(component.state);
  rewriteCodeExpr(component, methodMap, lexicalArgs, metadata.qwik?.replace);
  return state;
}

const checkIsObjectWithCodeBlock = (obj: any): obj is { code: string } => {
  return typeof obj == 'object' && obj?.code && typeof obj.code === 'string';
};

export function getLexicalScopeVars(component: MitosisComponent) {
  return ['props', 'state', ...Object.keys(component.refs), ...Object.keys(component.context.get)];
}

function rewriteCodeExpr(
  component: MitosisComponent,
  methodMap: MethodMap,
  lexicalArgs: string[],
  replace: Record<string, string> | undefined = {},
) {
  traverse(component).forEach(function (item) {
    if (!checkIsObjectWithCodeBlock(item)) {
      return;
    }

    let code = convertMethodToFunction(item.code, methodMap, lexicalArgs);

    Object.keys(replace).forEach((key) => {
      code = code.replace(key, replace[key]);
    });

    item.code = code;
  });
}

export type MethodMap = Record<string, 'method' | 'getter'>;

export function getStateMethodsAndGetters(state: MitosisComponent['state']): MethodMap {
  const methodMap: MethodMap = {};
  Object.keys(state).forEach((key) => {
    const stateVal = state[key];
    if (stateVal?.type === 'getter' || stateVal?.type === 'method') {
      methodMap[key] = stateVal.type;
    }
  });
  return methodMap;
}