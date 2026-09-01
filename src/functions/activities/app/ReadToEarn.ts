import { URLs } from '../../../constants/urls'
import type { HttpRequestConfig } from '../../../util/Http'
import { randomUUID } from 'crypto'
import type { AppDashboardData } from '../../../interface/AppDashBoardData'
import { BaseActivity } from '../BaseActivity'

const SAPPHIRE_USER_AGENT =
    'Mozilla/5.0 (iPad; CPU iPad OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/605.1.15 BingSapphire/33.4.440603001'

export class ReadToEarn extends BaseActivity {
    public async doReadToEarn(appData?: AppDashboardData | null) {
        if (!this.bot.accessToken) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'READ-TO-EARN',
                'Skipping: App access token not available, this activity requires it!'
            )
            return
        }

        const delayMin = this.bot.config.searchSettings.readDelay.min
        const delayMax = this.bot.config.searchSettings.readDelay.max
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)

        // Find promotion from app dashboard if available
        const readPromotion = appData?.response?.promotions?.find(p => {
            const type = (p.attributes?.type ?? '').toLowerCase()
            const offerId = (p.attributes?.offerid ?? '').toLowerCase()
            return (
                type === 'msnreadearn' ||
                offerId.includes('readarticle') ||
                offerId.includes('read_to_earn') ||
                offerId.includes('readtoearn')
            )
        })

        if (readPromotion) {
            const pointMax = parseInt(readPromotion.attributes['pointmax'] ?? '0')
            const pointProgress = parseInt(readPromotion.attributes['pointprogress'] ?? '0')
            if (pointMax > 0 && pointProgress >= pointMax) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `All "Read to Earn" items have already been completed (${pointProgress}/${pointMax} pts)`
                )
                return
            }
        }

        const geo = (this.bot.userData.geoLocale ?? 'US').toUpperCase()
        const dynamicOfferId = readPromotion?.attributes['offerid']

        const candidateOfferIds: string[] = []
        if (dynamicOfferId) candidateOfferIds.push(dynamicOfferId)
        if (!candidateOfferIds.includes(`${geo}_readarticle3_30points`)) {
            candidateOfferIds.push(`${geo}_readarticle3_30points`)
        }
        if (!candidateOfferIds.includes('ENUS_readarticle3_30points')) {
            candidateOfferIds.push('ENUS_readarticle3_30points')
        }
        if (!candidateOfferIds.includes('readarticle3_30points')) {
            candidateOfferIds.push('readarticle3_30points')
        }
        if (!candidateOfferIds.includes('readarticle_30points')) {
            candidateOfferIds.push('readarticle_30points')
        }

        let currentOfferId = candidateOfferIds[0]

        this.bot.logger.info(
            this.bot.isMobile,
            'READ-TO-EARN',
            `Starting Read to Earn | geo=${this.bot.userData.geoLocale} | offerId=${currentOfferId} | delayRange=${delayMin}-${delayMax} | currentBalance=${startBalance}`
        )

        try {
            const articleCount = 10
            let totalGained = 0
            let articlesRead = 0
            let oldBalance = startBalance
            let candidateIndex = 0

            for (let i = 0; i < articleCount; ++i) {
                let gainedPoints = 0
                let newBalance = oldBalance
                let responseStatus = 0

                // Attempt to submit read article (with candidate fallback on initial attempt if needed)
                while (candidateIndex < candidateOfferIds.length) {
                    currentOfferId = candidateOfferIds[candidateIndex]

                    const jsonData = {
                        risk_context: {},
                        type: 101,
                        channel: 'SAIOS',
                        attributes: {
                            offerid: currentOfferId
                        },
                        id: randomUUID(),
                        amount: 1,
                        country: this.bot.userData.geoLocale
                    }

                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'READ-TO-EARN',
                        `Submitting Read to Earn activity | article=${i + 1}/${articleCount} | offerId=${currentOfferId} | id=${jsonData.id}`
                    )

                    const request: HttpRequestConfig = {
                        url: URLs.platform.activities,
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${this.bot.accessToken}`,
                            'Content-Type': 'application/json',
                            Accept: '*/*',
                            'User-Agent': SAPPHIRE_USER_AGENT,
                            'X-Rewards-AppId': 'SAIOS/33.4.440603001',
                            'X-Rewards-PartnerId': 'startapp',
                            'X-Rewards-Country': this.bot.userData.geoLocale,
                            'X-Rewards-Language': this.bot.userData.langCode,
                            'X-Rewards-Flights': 'rwgobig',
                            'X-Rewards-IsMobile': 'true'
                        },
                        data: JSON.stringify(jsonData)
                    }

                    const response = await this.bot.http.request<{ response?: { balance?: number } }>(request)
                    responseStatus = response?.status ?? 0

                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'READ-TO-EARN',
                        `Received Read to Earn response | article=${i + 1}/${articleCount} | status=${responseStatus}`
                    )

                    newBalance = Number(response?.data?.response?.balance ?? oldBalance)
                    gainedPoints = newBalance - oldBalance

                    this.bot.logger.debug(
                        this.bot.isMobile,
                        'READ-TO-EARN',
                        `Balance delta after article | article=${i + 1}/${articleCount} | previousBalance=${oldBalance} | currentBalance=${newBalance} | pointsGained=${gainedPoints}`
                    )

                    // If we got points, stick with this working offerId
                    if (gainedPoints > 0) {
                        break
                    }

                    // If first article failed, try next candidate offerId
                    if (i === 0 && candidateIndex + 1 < candidateOfferIds.length) {
                        candidateIndex++
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'READ-TO-EARN',
                            `Trying next candidate offerId: ${candidateOfferIds[candidateIndex]}`
                        )
                        await this.bot.utils.wait(2000)
                    } else {
                        break
                    }
                }

                if (gainedPoints <= 0) {
                    // Retry once after waiting in case of cooldown
                    if (i > 0) {
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'READ-TO-EARN',
                            `Retrying article ${i + 1}/${articleCount} after delay...`
                        )
                        await this.bot.utils.wait(5000)

                        const retryJsonData = {
                            risk_context: {},
                            type: 101,
                            channel: 'SAIOS',
                            attributes: {
                                offerid: currentOfferId
                            },
                            id: randomUUID(),
                            amount: 1,
                            country: this.bot.userData.geoLocale
                        }

                        const retryRequest: HttpRequestConfig = {
                            url: URLs.platform.activities,
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${this.bot.accessToken}`,
                                'Content-Type': 'application/json',
                                Accept: '*/*',
                                'User-Agent': SAPPHIRE_USER_AGENT,
                                'X-Rewards-AppId': 'SAIOS/33.4.440603001',
                                'X-Rewards-PartnerId': 'startapp',
                                'X-Rewards-Country': this.bot.userData.geoLocale,
                                'X-Rewards-Language': this.bot.userData.langCode,
                                'X-Rewards-Flights': 'rwgobig',
                                'X-Rewards-IsMobile': 'true'
                            },
                            data: JSON.stringify(retryJsonData)
                        }

                        const retryResp = await this.bot.http.request<{ response?: { balance?: number } }>(retryRequest)
                        newBalance = Number(retryResp?.data?.response?.balance ?? oldBalance)
                        gainedPoints = newBalance - oldBalance
                    }

                    if (gainedPoints <= 0) {
                        this.bot.logger.info(
                            this.bot.isMobile,
                            'READ-TO-EARN',
                            `No points gained, stopping Read to Earn | article=${i + 1}/${articleCount} | status=${responseStatus} | pointsGained=0 | currentBalance=${newBalance}`
                        )
                        break
                    }
                }

                this.bot.userData.currentPoints = newBalance
                this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints
                totalGained += gainedPoints
                articlesRead = i + 1
                oldBalance = newBalance

                this.bot.logger.info(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `Read article ${i + 1}/${articleCount} | status=${responseStatus} | pointsGained=${gainedPoints} | currentBalance=${newBalance}`,
                    'green'
                )

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'READ-TO-EARN',
                    `Waiting between articles | article=${i + 1}/${articleCount} | delayRange=${delayMin}-${delayMax}`
                )

                if (i < articleCount - 1) {
                    await this.bot.utils.wait(this.bot.utils.randomDelay(delayMin, delayMax))
                }
            }

            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)

            this.bot.logger.info(
                this.bot.isMobile,
                'READ-TO-EARN',
                `Completed Read to Earn | articlesRead=${articlesRead} | pointsGained=${totalGained} | previousBalance=${startBalance} | currentBalance=${finalBalance}`
            )
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'READ-TO-EARN',
                `Error during Read to Earn | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
