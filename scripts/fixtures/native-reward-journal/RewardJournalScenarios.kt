package com.yandexmobileads.rewarded

import kotlin.concurrent.thread

private class Disk {
    var durable = mapOf<String, String>()
    var visible = mapOf<String, String>()
    var fails = false
    var throws = false
    var writes = 0

    fun open(stampEarned: (String) -> String = { it }) = RewardJournal(durable, stampEarned) { next ->
        writes += 1
        visible = next.toMap() // SharedPreferences updates memory even if commit fails.
        if (throws) throw IllegalStateException("disk error")
        if (fails) false else { durable = next.toMap(); true }
    }
}

fun main(args: Array<String>) {
    var checks = 0
    var scenarios = 0
    fun verify(condition: Boolean) { check(condition); checks += 1 }
    fun scenario(run: () -> Unit) { run(); scenarios += 1 }

    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        verify(journal.earnedSnapshots().isEmpty())
        verify(disk.open().earnedSnapshots().isEmpty()) // Process death before earned is unknown.
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        verify(journal.earned("ad1"))
        verify(disk.durable["e:reward1"] == "frozen1") // Saved before returning to JS.
        verify(disk.open().earnedSnapshots() == listOf("frozen1"))
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        verify(journal.earned("ad1")); verify(journal.earned("ad1"))
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        verify(journal.acknowledge("reward1")); verify(journal.acknowledge("reward1"))
        verify(journal.earned("ad1", "reward1", "frozen1"))
        verify(disk.open().earnedSnapshots().isEmpty())
        verify(!disk.open().prepare("anotherAd", "reward1", "changed"))
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        disk.fails = true
        verify(!journal.earned("ad1"))
        verify(disk.visible["e:reward1"] == "frozen1")
        verify(!disk.durable.containsKey("e:reward1"))
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        disk.fails = false
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        verify(disk.open().earnedSnapshots() == listOf("frozen1"))
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1")); verify(journal.earned("ad1"))
        disk.fails = true
        verify(!journal.acknowledge("reward1"))
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        verify(disk.open().earnedSnapshots() == listOf("frozen1"))
        disk.fails = false
        verify(journal.acknowledge("reward1")); verify(disk.open().earnedSnapshots().isEmpty())
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        verify(journal.prepare("ad2", "reward2", "frozen2"))
        verify(journal.discardPrepared("ad1"))
        verify(journal.earned("ad1", "reward1", "frozen1")) // Native late callback uses its captured session.
        verify(journal.earned("ad2"))
        verify(disk.open().earnedSnapshots() == listOf("frozen1", "frozen2"))
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        verify(journal.discardPrepared("ad1"))
        verify(!journal.earned("unrelated"))
        verify(!journal.acknowledge("reward1"))
        verify(disk.open().earnedSnapshots().isEmpty())
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        verify(!journal.prepare("ad1", "reward1", "changed"))
        verify(!journal.prepare("ad2", "reward1", "frozen1"))
        verify(journal.earned("ad1")); verify(journal.earnedSnapshots() == listOf("frozen1"))
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        disk.fails = true
        verify(!journal.prepare("ad1", "reward1", "frozen1"))
        verify(!journal.earned("ad1"))
        verify(disk.open().earnedSnapshots().isEmpty())
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        disk.throws = true
        verify(!journal.earned("ad1"))
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        disk.throws = false
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        verify(disk.open().earnedSnapshots() == listOf("frozen1"))
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        val callbacks = (1..16).map { thread { check(journal.earned("ad1")) } }
        callbacks.forEach { it.join() }
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        verify(journal.acknowledge("reward1"))
        verify(disk.open().earnedSnapshots().isEmpty())
    }
    scenario {
        val disk = Disk(); val journal = disk.open()
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        disk.fails = true
        verify(!journal.earned("ad1"))
        verify(journal.earnedSnapshots() == listOf("frozen1"))
        verify(disk.open().earnedSnapshots().isEmpty()) // Honest boundary: no durable native evidence after failed disk write + kill.
    }
    scenario {
        val disk = Disk(); var nativeEarnedTime = 100L
        val journal = disk.open { snapshot -> "$snapshot:earnedAt:$nativeEarnedTime" }
        verify(journal.prepare("ad1", "reward1", "frozen1"))
        disk.fails = true
        verify(!journal.earned("ad1"))
        nativeEarnedTime = 200
        verify(!journal.earned("ad1"))
        disk.fails = false
        verify(journal.earnedSnapshots() == listOf("frozen1:earnedAt:100"))
        verify(disk.open().earnedSnapshots() == listOf("frozen1:earnedAt:100"))
    }
    scenario {
        val ownership = RewardShowOwnership()
        ownership.request(1_000)
        verify(ownership.isActive(180_999, true, false))
        verify(!ownership.isActive(181_000, true, false)) // No shown callback or Activity; focused host is actual native evidence.
        verify(!ownership.isActive(200_000, false, false)) // An abandoned request does not re-lock on background.
    }
    scenario {
        val ownership = RewardShowOwnership()
        ownership.request(1_000)
        verify(ownership.isActive(500_000, false, false)) // Background without a focused host cannot prove absence.
        verify(ownership.isActive(500_000, true, true)) // Resumed host cannot supersede a live fullscreen Activity.
        verify(!ownership.isActive(500_000, true, false))
    }
    scenario {
        val ownership = RewardShowOwnership()
        ownership.request(1_000); ownership.shown(); ownership.fullscreenStarted()
        verify(ownership.isActive(500_000, true, true))
        ownership.fullscreenEnded()
        verify(ownership.isActive(500_000, false, false))
        verify(!ownership.isActive(500_000, true, false)) // Actual ad Activity finished + focused resumed host; missing dismiss reconciled.
    }
    scenario {
        val ownership = RewardShowOwnership()
        ownership.request(1_000); ownership.shown()
        verify(ownership.isActive(500_000, true, false)) // Unknown same-host overlay: no reliable Activity close evidence.
        ownership.terminal()
        verify(!ownership.isActive(500_000, true, false))
    }
    scenario {
        val ownership = RewardShowOwnership()
        ownership.request(1_000)
        verify(!ownership.isActive(500_000, true, false))
        verify(ownership.isActive(500_001, true, true)) // A late actual native fullscreen still blocks another show.
        verify(!ownership.isActive(500_002, true, false))
    }
    scenario {
        // Supplied by the runner from the actual TypeScript ECONOMY module.
        val actualSectorAmounts = args.single().split(',').map { it.toInt() }
        verify(actualSectorAmounts.size == 8)
        for ((sector, actualAmount) in actualSectorAmounts.withIndex()) {
            for (amount in actualSectorAmounts) {
                verify(RewardReceiptContract.acceptsWheel(sector, amount.toDouble()) == (amount == actualAmount))
            }
        }
        verify(!RewardReceiptContract.acceptsWheel(-1, actualSectorAmounts[0].toDouble()))
        verify(!RewardReceiptContract.acceptsWheel(8, actualSectorAmounts[0].toDouble()))
        verify(!RewardReceiptContract.acceptsWheel(0, Double.NaN))
        verify(!RewardReceiptContract.acceptsWheel(0, Double.POSITIVE_INFINITY))
    }
    println("{\"passed\":true,\"scenarios\":$scenarios,\"checks\":$checks}")
}
