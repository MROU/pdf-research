// pdfium-fixed-loader.js

let _pdfium = null;

export async function initPDFium() {
  if (_pdfium) return _pdfium;
  
  console.log('🔧 初始化 PDFium...');
  
  try {
    const moduleFactory = await import('./pdfium.esm.js');
    
    _pdfium = await moduleFactory.default({
      locateFile: (path) => {
        console.log('📦 加载文件:', path);
        if (path.endsWith('.wasm')) {
          return new URL('./pdfium.esm.wasm', import.meta.url).href;
        }
        return path;
      }
    });
    
    // 等待完全初始化
    if (_pdfium.ready) {
      await _pdfium.ready;
    }
    
    console.log('✅ PDFium 实例已创建');
    console.log('📊 PDFium 模块信息:', {
      has_malloc: typeof _pdfium._malloc === 'function',
      has_free: typeof _pdfium._free === 'function',
      has_FPDF_LoadMemDocument: typeof _pdfium._FPDF_LoadMemDocument === 'function',
      heap: _pdfium.HEAPU8 ? '可用' : '不可用'
    });
    
    return _pdfium;
    
  } catch (error) {
    console.error('❌ PDFium 初始化失败:', error);
    throw error;
  }
}

/**
 * 正确加载 PDF 文档（修复版）
 */
export async function loadPDFDocument(pdfium, arrayBuffer) {
  if (!pdfium || !arrayBuffer) {
    throw new Error('参数无效');
  }
  
  console.log('📄 开始加载 PDF 文档...');
  console.log('📊 PDF 数据大小:', arrayBuffer.byteLength, '字节');
  
  // 验证 PDF 文件头
  const data = new Uint8Array(arrayBuffer);
  const header = String.fromCharCode(...data.slice(0, 8));
  console.log('🔍 PDF 文件头:', header);
  
  if (!header.startsWith('%PDF-')) {
    console.warn('⚠️ 文件可能不是有效的 PDF');
    // 但仍然尝试加载
  }
  

  // 关键：分配内存并将数据复制到 WASM 内存
  const bufferSize = data.length;
  console.log('📦 分配内存:', bufferSize, '字节');
  
  const bufferPtr = pdfium._malloc(bufferSize);
  if (!bufferPtr) {
    throw new Error('内存分配失败');
  }
  
  console.log('📊 内存地址:', bufferPtr);
  
  // 将数据复制到 WASM 内存
  try {
    console.log('📤 复制数据到 WASM 内存...');
    pdfium.HEAPU8.set(data, bufferPtr);
    
    const verifyBytes = Math.min(10, data.length);
    for (let i = 0; i < verifyBytes; i++) {
      if (pdfium.HEAPU8[bufferPtr + i] !== data[i]) {
        console.error(`❌ 数据复制验证失败，位置 ${i}: ${pdfium.HEAPU8[bufferPtr + i]} !== ${data[i]}`);
        throw new Error('数据复制到 WASM 内存失败');
      }
    }
    
    console.log('✅ 数据复制验证通过');
    
  } catch (copyError) {
    console.error('❌ 数据复制失败:', copyError);
    pdfium._free(bufferPtr);
    throw new Error('无法复制数据到 WASM 内存');
  }
  
  console.log('🚀 尝试加载 PDF 文档...');
  
  let doc = 0;
  const triedMethods = [];
  
  // 使用 _FPDF_LoadMemDocument
  if (typeof pdfium._FPDF_LoadMemDocument === 'function') {
    triedMethods.push('_FPDF_LoadMemDocument');
    console.log('🔄 尝试方法: _FPDF_LoadMemDocument');
    doc = pdfium._FPDF_LoadMemDocument(bufferPtr, bufferSize, null);
    console.log(`  结果: ${doc}`);
  }
  
  // 使用空字符串密码
  if (doc === 0 && typeof pdfium._FPDF_LoadMemDocument === 'function') {
    triedMethods.push('_FPDF_LoadMemDocument with empty password');
    console.log('🔄 尝试方法: _FPDF_LoadMemDocument (空密码)');
    doc = pdfium._FPDF_LoadMemDocument(bufferPtr, bufferSize, "");
    console.log(`  结果: ${doc}`);
  }
  
  // 使用 _FPDF_LoadMemDocument64
  if (doc === 0 && typeof pdfium._FPDF_LoadMemDocument64 === 'function') {
    triedMethods.push('_FPDF_LoadMemDocument64');
    console.log('🔄 尝试方法: _FPDF_LoadMemDocument64');
    doc = pdfium._FPDF_LoadMemDocument64(bufferPtr, bufferSize, null);
    console.log(`  结果: ${doc}`);
  }
  
  // 尝试不带下划线的函数
  if (doc === 0 && typeof pdfium.FPDF_LoadMemDocument === 'function') {
    triedMethods.push('FPDF_LoadMemDocument (不带下划线)');
    console.log('🔄 尝试方法: FPDF_LoadMemDocument');
    doc = pdfium.FPDF_LoadMemDocument(bufferPtr, bufferSize, null);
    console.log(`  结果: ${doc}`);
  }
  
  // 检查结果
  if (doc === 0) {
    // 获取错误信息
    let errorCode = 3;
    if (typeof pdfium._FPDF_GetLastError === 'function') {
      errorCode = pdfium._FPDF_GetLastError();
    } else if (typeof pdfium.FPDF_GetLastError === 'function') {
      errorCode = pdfium.FPDF_GetLastError();
    }
    
    console.error('❌ 所有加载方法都失败');
    console.error('📊 尝试的方法:', triedMethods);
    console.error('📊 错误码:', errorCode);
    
    // 释放内存
    pdfium._free(bufferPtr);
    
    // 尝试其他诊断
    await diagnosePDFIssue(pdfium, data);
    
    throw new Error(`PDF 加载失败 (错误码: ${errorCode})`);
  }
  
  console.log('✅ PDF 文档加载成功');
  console.log('📊 文档句柄:', doc);
  
  // 返回文档句柄和缓冲区指针（需要一起释放）
  return {
    doc: doc,
    bufferPtr: bufferPtr,
    bufferSize: bufferSize,
    pdfium: pdfium
  };
}

/**
 * 诊断 PDF 问题
 */
async function diagnosePDFIssue(pdfium, data) {
  console.log('🔍 开始 PDF 诊断...');
  
  // 1. 检查文件头
  const headerStr = String.fromCharCode(...data.slice(0, 5));
  console.log('  文件头:', headerStr);
  
  // 2. 检查文件尾
  const tailStr = String.fromCharCode(...data.slice(-8));
  console.log('  文件尾:', tailStr);
  
  // 3. 查找 PDF 结束标记
  const textDecoder = new TextDecoder('utf-8');
  const text = textDecoder.decode(data);
  const pdfStart = text.indexOf('%PDF-');
  const pdfEnd = text.lastIndexOf('%%EOF');
  
  console.log('  PDF 开始位置:', pdfStart);
  console.log('  PDF 结束位置:', pdfEnd);
  
  if (pdfStart === -1) {
    console.log('  ❌ 未找到 PDF 文件头');
  }
  
  if (pdfEnd === -1) {
    console.log('  ⚠️ 未找到 PDF 结束标记');
  }
  
  // 4. 检查是否是 base64 编码
  if (text.includes('JVBERi0') || text.includes('base64')) {
    console.log('  ℹ️ 可能是 base64 编码的 PDF');
    
    // 尝试解码 base64
    const base64Match = text.match(/[A-Za-z0-9+/=]{100,}/);
    if (base64Match) {
      console.log('  🔧 尝试解码 base64...');
      try {
        const base64Data = base64Match[0];
        const decoded = atob(base64Data);
        const decodedArray = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          decodedArray[i] = decoded.charCodeAt(i);
        }
        
        const decodedHeader = String.fromCharCode(...decodedArray.slice(0, 5));
        console.log('  解码后文件头:', decodedHeader);
      } catch (e) {
        console.log('  ❌ base64 解码失败');
      }
    }
  }
  
  // 5. 检查文件大小
  if (data.length < 100) {
    console.log('  ⚠️ 文件可能过小 (小于 100 字节)');
  }
  
  // 6. 检查 PDF 版本
  const versionMatch = text.match(/%PDF-([\d.]+)/);
  if (versionMatch) {
    console.log('  📊 PDF 版本:', versionMatch[1]);
  }
}

/**
 * 安全释放 PDF 文档和内存
 */
export function safeClosePDFDocument(result) {
  if (!result) return;
  
  const { doc, bufferPtr, pdfium } = result;
  
  try {
    // 关闭文档
    if (doc && doc !== 0) {
      if (typeof pdfium._FPDF_CloseDocument === 'function') {
        pdfium._FPDF_CloseDocument(doc);
      } else if (typeof pdfium.FPDF_CloseDocument === 'function') {
        pdfium.FPDF_CloseDocument(doc);
      }
      console.log('🗑️ 文档已关闭');
    }
  } catch (docError) {
    console.warn('关闭文档时出错:', docError);
  }
  
  try {
    // 释放内存
    if (bufferPtr) {
      pdfium._free(bufferPtr);
      console.log('🗑️ 内存已释放');
    }
  } catch (memError) {
    console.warn('释放内存时出错:', memError);
  }
}

/**
 * 从 PDF 提取文本
 */
export async function extractTextFromPDF(arrayBuffer) {
  let pdfium;
  let docResult;
  
  try {
    // 1. 初始化 PDFium
    pdfium = await initPDFium();
    
    // 2. 加载 PDF 文档
    docResult = await loadPDFDocument(pdfium, arrayBuffer);
    
    const { doc } = docResult;
    
    // 3. 获取页面数量
    let pageCount = 0;
    if (typeof pdfium._FPDF_GetPageCount === 'function') {
      pageCount = pdfium._FPDF_GetPageCount(doc);
    } else if (typeof pdfium.FPDF_GetPageCount === 'function') {
      pageCount = pdfium.FPDF_GetPageCount(doc);
    }
    
    console.log(`📑 总页数: ${pageCount}`);
    
    if (pageCount <= 0) {
      throw new Error('PDF 没有有效页面');
    }
    
    // 4. 提取文本
    let fullText = '';
    const processedPages = [];
    
    for (let i = 0; i < pageCount; i++) {
      console.log(`🔄 处理第 ${i + 1}/${pageCount} 页...`);
      
      // 加载页面
      let page = 0;
      if (typeof pdfium._FPDF_LoadPage === 'function') {
        page = pdfium._FPDF_LoadPage(doc, i);
        console.warn(`⚠️_FPDF_LoadPage page`);
      } else if (typeof pdfium.FPDF_LoadPage === 'function') {
        console.warn(`FPDF_LoadPage page`);
        page = pdfium.FPDF_LoadPage(doc, i);
      }
      

      if (!page || page === 0) {
        console.warn(`⚠️ 第 ${i + 1} 页加载失败，跳过`);
        continue;
      }
      
      try {
        // 加载文本页面
        let textPage = 0;
        if (typeof pdfium._FPDFText_LoadPage === 'function') {
          textPage = pdfium._FPDFText_LoadPage(page);
        } else if (typeof pdfium.FPDFText_LoadPage === 'function') {
          textPage = pdfium.FPDFText_LoadPage(page);
        }
        
        if (!textPage || textPage === 0) {
          console.warn(`⚠️ 第 ${i + 1} 页文本提取失败，跳过`);
          continue;
        }
        
        try {
          // 获取字符数
          let charCount = 0;
          if (typeof pdfium._FPDFText_CountChars === 'function') {
            charCount = pdfium._FPDFText_CountChars(textPage);
          } else if (typeof pdfium.FPDFText_CountChars === 'function') {
            charCount = pdfium.FPDFText_CountChars(textPage);
          }
          
          console.log(`  📝 字符数: ${charCount}`);
          
          if (charCount > 0) {
            // 提取文本
            const pageText = extractPageText(pdfium, textPage, charCount);
            if (pageText) {
              fullText += `=== 第 ${i + 1} 页 ===\n${pageText}\n\n`;
              processedPages.push(i + 1);
            }
          }
        } finally {
          // 关闭文本页面
          if (typeof pdfium._FPDFText_ClosePage === 'function') {
            pdfium._FPDFText_ClosePage(textPage);
          } else if (typeof pdfium.FPDFText_ClosePage === 'function') {
            pdfium.FPDFText_ClosePage(textPage);
          }
        }
      } finally {
        // 关闭页面
        if (typeof pdfium._FPDF_ClosePage === 'function') {
          pdfium._FPDF_ClosePage(page);
        } else if (typeof pdfium.FPDF_ClosePage === 'function') {
          pdfium.FPDF_ClosePage(page);
        }
      }
    }
    
    console.log(`✅ 提取完成! 处理了 ${processedPages.length}/${pageCount} 页`);
    
    return {
      success: true,
      text: fullText.trim(),
      pageCount: pageCount,
      processedPages: processedPages.length,
      allPages: pageCount,
      charCount: fullText.length
    };
    
  } catch (error) {
    console.error('❌ 提取失败:', error);
    return {
      success: false,
      error: error.message,
      text: ''
    };
  } finally {
    // 清理资源
    if (docResult) {
      safeClosePDFDocument(docResult);
    }
  }
}

/**
 * 提取单个页面文本
 */
function extractPageText(pdfium, textPage, charCount) {
  try {
    const bufferSize = charCount * 4 + 1;
    const bufferPtr = pdfium._malloc(bufferSize);
    
    if (!bufferPtr) {
      console.error('❌ 文本缓冲区内存分配失败');
      return '';
    }
    
    try {
      // 清空缓冲区
      for (let i = 0; i < bufferSize; i++) {
        pdfium.HEAPU8[bufferPtr + i] = 0;
      }
      
      // 提取文本
      let extracted = 0;
      if (typeof pdfium._FPDFText_GetText === 'function') {
        extracted = pdfium._FPDFText_GetText(textPage, 0, charCount, bufferPtr);
      } else if (typeof pdfium.FPDFText_GetText === 'function') {
        extracted = pdfium.FPDFText_GetText(textPage, 0, charCount, bufferPtr);
      }
      
      if (extracted <= 0) {
        console.warn('⚠️ 没有提取到文本');
        return '';
      }
      
      // 转换为字符串
      let text = '';

      if (typeof pdfium.UTF8ToString === 'function') {
        text = pdfium.UTF8ToString(bufferPtr);
      } else {
        text = bufferToString(pdfium, bufferPtr);
      }
      
      return text;
      
    } finally {
      pdfium._free(bufferPtr);
    }
  } catch (error) {
    console.error('❌ 提取页面文本失败:', error);
    return '';
  }
}

function bufferToString(pdfium, bufferPtr) {
  try {
    const bytes = [];
    let i = 0;
    
    // 读取直到遇到 null 终止符
    while (true) {
      const byte = pdfium.HEAPU8[bufferPtr + i];
      if (byte === 0) break;
      bytes.push(byte);
      i++;
      
      // 安全限制
      if (i > 1000000) {
        console.warn('⚠️ 文本过长，可能有问题');
        break;
      }
    }
    
    // 解码为字符串
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch (error) {
    console.error('❌ 缓冲区转字符串失败:', error);
    return '';
  }
}

/**
 * 创建测试 PDF
 */
export function createTestPDF() {
  // 创建一个简单的 PDF 文件用于测试
  const pdfContent = [
    '%PDF-1.4',
    '%',
    '1 0 obj',
    '<<',
    '/Type /Catalog',
    '/Pages 2 0 R',
    '>>',
    'endobj',
    '2 0 obj',
    '<<',
    '/Type /Pages',
    '/Count 1',
    '/Kids [3 0 R]',
    '>>',
    'endobj',
    '3 0 obj',
    '<<',
    '/Type /Page',
    '/Parent 2 0 R',
    '/MediaBox [0 0 612 792]',
    '/Contents 4 0 R',
    '/Resources <<',
    '/Font <<',
    '/F1 5 0 R',
    '>>',
    '>>',
    '>>',
    'endobj',
    '4 0 obj',
    '<<',
    '/Length 68',
    '>>',
    'stream',
    'BT',
    '/F1 24 Tf',
    '100 700 Td',
    '(This is a test PDF document for PDFium) Tj',
    'ET',
    'endstream',
    'endobj',
    '5 0 obj',
    '<<',
    '/Type /Font',
    '/Subtype /Type1',
    '/BaseFont /Helvetica',
    '>>',
    'endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000010 00000 n ',
    '0000000055 00000 n ',
    '0000000106 00000 n ',
    '0000000260 00000 n ',
    '0000000365 00000 n ',
    'trailer',
    '<<',
    '/Size 6',
    '/Root 1 0 R',
    '>>',
    'startxref',
    '470',
    '%%EOF'
  ].join('\n');
  
  return new TextEncoder().encode(pdfContent).buffer;
}

/**
 * 测试函数
 */
export async function testPDFium() {
  try {
    console.log('🧪 开始测试 PDFium...');
    
    // 1. 测试初始化
    const pdfium = await initPDFium();
    
    // 2. 创建测试 PDF
    console.log('📄 创建测试 PDF...');
    const testPDF = createTestPDF();
    
    // 3. 测试加载
    console.log('🚀 测试加载 PDF...');
    const docResult = await loadPDFDocument(pdfium, testPDF);
    
    if (docResult.doc && docResult.doc !== 0) {
      console.log('✅ PDF 加载测试通过!');
      
      // 释放资源
      safeClosePDFDocument(docResult);
      return true;
    } else {
      console.log('❌ PDF 加载测试失败');
      return false;
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
    return false;
  }
}

export default {
  initPDFium,
  loadPDFDocument,
  extractTextFromPDF,
  safeClosePDFDocument,
  createTestPDF,
  testPDFium
};  