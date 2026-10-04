/** Screen wake locks scoped to one active recording and its visible document. */
var RecordingWakeLock = (function () {
  function create(options) {
    options = options || {};
    var nav = options.navigator;
    var doc = options.document;
    var onChange = options.onChange;
    var recording = false;
    var epoch = 0;
    var held = null;
    var pending = null;
    var status = 'idle';

    function setStatus(next) {
      if (status === next) return;
      status = next;
      if (typeof onChange === 'function') {
        // A display failure must not interfere with acquiring/releasing resources.
        try { onChange(status); } catch (error) { /* Optional status observer. */ }
      }
    }

    function isVisible() {
      return !!doc && doc.visibilityState === 'visible';
    }

    function releaseSafely(lock) {
      if (!lock || lock.released) return Promise.resolve();
      try {
        return Promise.resolve(lock.release()).catch(function () {});
      } catch (error) {
        return Promise.resolve();
      }
    }

    function releaseHeld() {
      var previous = held;
      held = null;
      if (!previous) return Promise.resolve();
      previous.lock.removeEventListener('release', previous.onRelease);
      return releaseSafely(previous.lock);
    }

    function isCurrent(requestEpoch) {
      return recording && requestEpoch === epoch && isVisible();
    }

    function request() {
      if (!recording) return Promise.resolve();
      if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
        setStatus('unsupported');
        return Promise.resolve();
      }
      if (!isVisible()) {
        setStatus('released');
        return Promise.resolve();
      }
      if (held && !held.lock.released) return Promise.resolve();
      if (held) releaseHeld();
      if (pending) return pending.promise;

      var requestEpoch = epoch;
      var operation = { promise: null };
      pending = operation;
      setStatus('requesting');
      // A status observer can stop the recording synchronously.
      if (!isCurrent(requestEpoch)) {
        if (pending === operation) pending = null;
        return Promise.resolve();
      }

      var result;
      try {
        result = nav.wakeLock.request('screen');
      } catch (error) {
        if (pending === operation) pending = null;
        if (isCurrent(requestEpoch)) setStatus('unavailable');
        return Promise.resolve();
      }

      operation.promise = Promise.resolve(result).then(function (lock) {
        // Requests cannot be cancelled. A late grant belongs to its original
        // session and must be released even when a newer recording has started.
        if (!isCurrent(requestEpoch)) return releaseSafely(lock);
        if (lock.released) {
          setStatus('released');
          return;
        }

        var entry = {
          lock: lock,
          onRelease: function () {
            lock.removeEventListener('release', entry.onRelease);
            if (held !== entry) return;
            held = null;
            if (isCurrent(requestEpoch)) setStatus('released');
            // Do not retry here: system policy may have deliberately released it.
          }
        };
        held = entry;
        lock.addEventListener('release', entry.onRelease);
        setStatus('active');
      }, function () {
        if (isCurrent(requestEpoch)) setStatus('unavailable');
      }).finally(function () {
        if (pending === operation) pending = null;
      });
      return operation.promise;
    }

    function start() {
      recording = true;
      return request();
    }

    function stop() {
      recording = false;
      epoch += 1;
      pending = null;
      var released = releaseHeld();
      setStatus('idle');
      return released;
    }

    function handleVisibilityChange() {
      if (!recording) return Promise.resolve();
      if (isVisible()) return request();
      epoch += 1;
      pending = null;
      var released = releaseHeld();
      setStatus('released');
      return released;
    }

    return {
      start: start,
      stop: stop,
      handleVisibilityChange: handleVisibilityChange,
      getStatus: function () { return status; }
    };
  }

  return { create: create };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RecordingWakeLock;
}
