// LOQ Monitor | SensorService (one connected client)
// Author: cahyata
// Copyright (c) 2026 cahyata
using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;

/// <summary>Data the service measures only while at least one client asks for it. Every Acquire is matched by one Release.</summary>
interface IOnDemand
{
    void Acquire();
    void Release();
}

/// <summary>An on-demand request that only has to be counted: the reader looks at <see cref="Wanted"/>.</summary>
sealed class DemandCount : IOnDemand
{
    int _count;
    public bool Wanted => Volatile.Read(ref _count) > 0;
    public void Acquire() => Interlocked.Increment(ref _count);
    public void Release() => Interlocked.Decrement(ref _count);
}

/// <summary>
/// One connected client: its commands, the on-demand data it asked for, and the snapshots on their way to it.
/// Each client is sent on its own, so a slow one never holds up the sensor loop or the other clients. It gets
/// only the newest snapshot, and it is disconnected when one send takes longer than the limit.
/// </summary>
sealed class ClientSession(WebSocket socket, IReadOnlyDictionary<string, IOnDemand> onDemand, Action resetMinMax, TimeSpan sendLimit)
{
    readonly HashSet<string> _held = new();
    // Room for one: a new snapshot replaces the one that is still waiting.
    readonly Channel<byte[]> _outbox = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest });

    /// <summary>Queues a snapshot and returns at once.</summary>
    public void Post(byte[] snapshot) => _outbox.Writer.TryWrite(snapshot);

    /// <summary>Serves the client until it disconnects, falls too far behind or the service stops. Everything it asked for is released.</summary>
    public async Task Run(CancellationToken ct)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var sending = SendLoop(stop);
        try { await ReceiveLoop(stop.Token); }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException or ObjectDisposedException or IOException or System.Net.HttpListenerException) { /* the connection ended */ }
        finally
        {
            stop.Cancel();
            await sending;
            foreach (var name in _held) onDemand[name].Release();
            _held.Clear();
        }
    }

    /// <summary>Sends what is queued. A send that fails or takes too long drops the client and ends the session.</summary>
    async Task SendLoop(CancellationTokenSource session)
    {
        var ct = session.Token;
        try
        {
            await foreach (var snapshot in _outbox.Reader.ReadAllAsync(ct))
            {
                if (socket.State != WebSocketState.Open) return;
                await socket.SendAsync(new ArraySegment<byte>(snapshot), WebSocketMessageType.Text, true, CancellationToken.None)
                    .WaitAsync(sendLimit, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { /* the session is ending */ }
        catch
        {
            socket.Abort();      // stuck or broken
            session.Cancel();    // a pending receive does not always notice the abort
        }
    }

    async Task ReceiveLoop(CancellationToken ct)
    {
        var buffer = new byte[256];
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            // The wait itself is cancellable, so the session ends even while the socket still waits for the client.
            var received = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct).WaitAsync(ct);
            if (received.MessageType == WebSocketMessageType.Close) return;
            if (received.MessageType != WebSocketMessageType.Text || !received.EndOfMessage) continue;
            Handle(Encoding.UTF8.GetString(buffer, 0, received.Count));
        }
    }

    /// <summary>Commands restart min and max tracking, or ask for or release on-demand data ("fps-on", "net-off").
    /// None of them touches a hardware setting. Anything else is ignored.</summary>
    void Handle(string command)
    {
        if (command == "reset-minmax") { resetMinMax(); return; }
        var dash = command.LastIndexOf('-');
        if (dash < 0 || !onDemand.TryGetValue(command[..dash], out var data)) return;
        var name = command[..dash];
        if (command[dash..] == "-on" && _held.Add(name)) data.Acquire();
        else if (command[dash..] == "-off" && _held.Remove(name)) data.Release();
    }
}
