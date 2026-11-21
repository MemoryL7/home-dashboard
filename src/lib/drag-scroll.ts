/* ============================================================
   drag-scroll —— 鼠标按下拖拽上下滚动（滚动条已隐藏的区域用）。
   与触摸滚动不同，鼠标默认不拖拽滚动，这里补上：
   - mousedown 记起点，mousemove 同步 scrollTop，mouseup 结束；
   - 位移超过阈值才算拖拽，避免吃掉正常的点击（链接/按钮仍可点）；
   - 发生过拖拽时在 click 捕获阶段拦截一次，防止拖完松手误触链接；
   - move/up 挂 window 且在 up 时移除，不留全局监听。
   ============================================================ */

/** 给 el 开启鼠标拖拽滚动，返回解绑函数（移除 el 上的 mousedown）。 */
export function enableDragScroll(el: HTMLElement): () => void {
	const MOVE_THRESHOLD = 4; // px，超过才算拖拽
	let dragging = false;
	let moved = false;
	let startY = 0;
	let startTop = 0;

	const onMove = (e: MouseEvent): void => {
		if (!dragging) return;
		const dy = e.clientY - startY;
		if (!moved && Math.abs(dy) > MOVE_THRESHOLD) {
			moved = true;
			el.addClass("is-drag-scrolling");
		}
		if (moved) {
			e.preventDefault();
			el.scrollTop = startTop - dy;
		}
	};
	const onUp = (): void => {
		if (!dragging) return;
		dragging = false;
		el.removeClass("is-drag-scrolling");
		window.removeEventListener("mousemove", onMove);
		window.removeEventListener("mouseup", onUp);
		if (moved) {
			// 拖拽过的松手不是点击：捕获阶段拦一次（阻止链接跳转），本事件过后失效
			el.addEventListener(
				"click",
				(ev) => {
					ev.preventDefault();
					ev.stopPropagation();
				},
				{ capture: true, once: true },
			);
			moved = false;
		}
	};
	const onDown = (e: MouseEvent): void => {
		// 左键才拖；文本/输入框里按下的正常选字不参与
		if (e.button !== 0) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest("input, textarea")) return;
		dragging = true;
		moved = false;
		startY = e.clientY;
		startTop = el.scrollTop;
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};
	el.addEventListener("mousedown", onDown);
	return () => {
		el.removeEventListener("mousedown", onDown);
		window.removeEventListener("mousemove", onMove);
		window.removeEventListener("mouseup", onUp);
	};
}
